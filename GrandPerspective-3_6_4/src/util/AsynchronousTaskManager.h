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

#import <Cocoa/Cocoa.h>


@protocol TaskExecutor;

// Fired when a new task is scheduled.
extern NSString  *TaskScheduledEvent;

// Fired when a new task started executing.
extern NSString  *TaskStartedEvent;

// Fired when a task completed, successfully or not.
// It also fires when the task terminated because of an error, or it was aborted by the user.
extern NSString  *TaskCompletedEvent;


/* Manager that can run a task in a background thread. It only runs one task at most.
 */
@interface AsynchronousTaskManager : NSObject {

  NSObject <TaskExecutor>  *executor;

  NSConditionLock  *workLock;
  NSLock  *settingsLock;

  // "NO" iff the manager has not been disposed of.
  BOOL  alive;

  // Settings for the next task to run
  id  nextTaskInput;
  NSObject  *nextTaskCallback;
  SEL  nextTaskCallbackSelector; 
}

// Overrides super's designated initialiser.
- (instancetype) init NS_UNAVAILABLE;

/* Initialises the manager with the task executor, which is responsible for carrying out the actual
 * tasks.
 */
- (instancetype) initWithTaskExecutor: (NSObject <TaskExecutor>*)executor NS_DESIGNATED_INITIALIZER;

/* Call to free used resources (in particular the background thread that is being used).
 */
- (void) dispose;

@property (nonatomic, readonly, strong) NSObject<TaskExecutor> *taskExecutor;

/* Aborts the currently running task (if any)
 */
- (void) abortTask;

/* Starts running a task with the given input. It should be invoked from the main thread and the
 * input should be immutable.
 *
 * If there is another task currently being carried out, it is cancelled. When the task has
 * finished, the callback is called. If the task was aborted, the callback will be invoked with a
 * "nil" argument.
 */
- (void) asynchronouslyRunTaskWithInput:(id)input
                               callback:(id)callback
                               selector:(SEL)selector;
           
@end
