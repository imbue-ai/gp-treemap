/* GrandPerspective, Version 3.6.4 
 *   A utility for macOS that graphically shows disk usage. 
 * Copyright (C) 2005-2025, Erwin Bonsma 
 * 
 * This program is free software; you can redistribute it and/or modify it 
 * under the terms of the GNU General Public License as published by the Free 
 * Software Foundation; either version 2 of the License, or (at your option) 
 * any later version. 
 * 
 * This program is distributed in the hope that it will be useful, but WITHOUT 
 * ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or 
 * FITNESS FOR A PARTICULAR PURPOSE.  See the GNU General Public License for 
 * more details. 
 * 
 * You should have received a copy of the GNU General Public License along 
 * with this program; if not, write to the Free Software Foundation, Inc., 
 * 51 Franklin Street, Fifth Floor, Boston, MA  02110-1301, USA. 
 */

#import "AsynchronousTaskManager.h"


#import "TaskExecutor.h"

// Fired when a new task is scheduled.
NSString  *TaskScheduledEvent = @"taskScheduled";

// Fired when a new task is started executing.
NSString  *TaskStartedEvent = @"taskStarted";

// Fired when a task completed, successfully or not.
// It also fires when the task terminated because of an error, or it was aborted by the user.
NSString  *TaskCompletedEvent = @"taskCompleted";


enum {
  // Indicates that there is a task in progress or ready to be executed.
  BACKGROUND_THREAD_BUSY = 456,

  // Indicates that the thread can block or is blocking, waiting for a new task (or waiting for the
  // manager to be disposed).
  BACKGROUND_THREAD_IDLE, 
  
  // Indicates that the manager is being disposed off and that the thread should terminate.
  BACKGROUND_THREAD_SHUTDOWN
};


@interface AsynchronousTaskManager (PrivateMethods)

- (void) taskRunningLoop;

@end


@implementation AsynchronousTaskManager

- (instancetype) initWithTaskExecutor:(NSObject<TaskExecutor> *)executorVal {
  if (self = [super init]) {
    executor = [executorVal retain];
  
    workLock = [[NSConditionLock alloc] initWithCondition:BACKGROUND_THREAD_IDLE];
    settingsLock = [[NSLock alloc] init];
    alive = YES;

    [NSThread detachNewThreadSelector: @selector(taskRunningLoop)
                             toTarget: self
                           withObject: nil];
  }
  return self;
}


- (void) dealloc {
  NSAssert(!alive, @"Deallocating without a dispose.");

  [executor release];
  
  [workLock release];
  [settingsLock release];
  
  [nextTaskInput release];
  [nextTaskCallback release];
  
  [super dealloc];
}


- (void) dispose {
  [settingsLock lock];
  NSAssert(alive, @"Disposing of an already dead task manager.");

  alive = NO;

  if (workLock.condition == BACKGROUND_THREAD_BUSY) {
    // Abort task
    [executor abortTask];
  }
  else {
    // Notify the blocked thread (waiting on the BUSY condition)
    [workLock lock];
    [workLock unlockWithCondition: BACKGROUND_THREAD_BUSY];
  }
  
  [settingsLock unlock];
}


- (NSObject <TaskExecutor>*) taskExecutor {
  return executor;
}


- (void) abortTask {
  [settingsLock lock];

  if (workLock.condition == BACKGROUND_THREAD_BUSY) {
    // Abort task
    [executor abortTask];
  }

  [settingsLock unlock];
}


- (void) asynchronouslyRunTaskWithInput:(id)input
                               callback:(id)callback
                               selector:(SEL)selector {
  BOOL  taskWasScheduled = NO;

  [settingsLock lock];
  NSAssert(alive, @"Disturbing a dead task manager.");
  
  if (input != nextTaskInput) {
    taskWasScheduled = nextTaskInput != nil;

    [nextTaskInput release];
    nextTaskInput = [input retain];
  }
  if (callback != nextTaskCallback) {
    [nextTaskCallback release];
    nextTaskCallback = [callback retain];
  }
  nextTaskCallbackSelector = selector;

  if (workLock.condition == BACKGROUND_THREAD_BUSY) {
    // Abort task
    [executor abortTask];
  }
  else if ([workLock tryLockWhenCondition: BACKGROUND_THREAD_IDLE]) {
    // Notify the blocked thread (waiting on the BUSY condition)
    [workLock unlockWithCondition: BACKGROUND_THREAD_BUSY];
  }
  else {
    NSAssert(NO, @"Unexpected state of workLock.");
  }

  [settingsLock unlock];

  if (!taskWasScheduled) {
    // Note: Only fire an event when there was not already a scheduled task. In the latter case,
    // the old scheduled task is replaced by a new task, but the overall task execution status
    // did not change. This simplifies task count related bookkeeping.
    [NSNotificationCenter.defaultCenter postNotificationName: TaskScheduledEvent object: self];
  }
}

@end


@implementation AsynchronousTaskManager (PrivateMethods)

- (void) taskRunningLoop {
  do {
    NSAutoreleasePool  *pool = [[NSAutoreleasePool alloc] init];

    // Wait for a task to be carried out.
    [workLock lockWhenCondition: BACKGROUND_THREAD_BUSY];
            
    [settingsLock lock];
    if (alive) {
      NSAssert(nextTaskInput != nil, @"Task not set properly.");
      id  taskInput = [nextTaskInput autorelease];
      NSObject  *taskCallback = [nextTaskCallback autorelease];
      SEL  taskCallbackSelector = nextTaskCallbackSelector;
      nextTaskInput = nil;
      nextTaskCallback = nil;
      
      // Ensure that the executor will not immediately terminate when it did
      // not handle the last request to abort the task. 
      [executor prepareToRunTask];

      [NSNotificationCenter.defaultCenter postNotificationName: TaskStartedEvent object: self];

      [settingsLock unlock]; // Don't lock settings while running the task.
      id  taskOutput = [executor runTaskWithInput: taskInput];

      // Wait for callback to be done. This ensures that the task is handled (which could create
      // a view) before signalling completion of the task (which could trigger check on the
      // number of views).
      [taskCallback performSelectorOnMainThread: taskCallbackSelector
                                     withObject: taskOutput
                                  waitUntilDone: YES];

      [settingsLock lock];

      [NSNotificationCenter.defaultCenter postNotificationName: TaskCompletedEvent object: self];

      if (!alive) {
        // The manager has been disposed of while BUSY.
        [workLock unlockWithCondition: BACKGROUND_THREAD_SHUTDOWN];
      }
      else if (nextTaskInput == nil) { 
        [workLock unlockWithCondition: BACKGROUND_THREAD_IDLE];
      }
      else {
        [workLock unlockWithCondition: BACKGROUND_THREAD_BUSY];
      }
    }
    else {
      // The manager has been disposed of while IDLE.
      [workLock unlockWithCondition: BACKGROUND_THREAD_SHUTDOWN];
    }
    [settingsLock unlock];
    
    [pool release];
  } while (workLock.condition != BACKGROUND_THREAD_SHUTDOWN);

  NSLog(@"Thread terminated.");
}

@end // @implementation AsynchronousTaskManager (PrivateMethods)

