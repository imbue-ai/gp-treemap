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

#import "VisibleAsynchronousTaskManager.h"


#import "AsynchronousTaskManager.h"
#import "ProgressPanelControl.h"


@interface VisibleAsynchronousTaskManager (PrivateMethods)

- (void) notificationFired:(NSNotification *)notification;

@end


@interface CallbackHandler : NSObject { 
  ProgressPanelControl  *progressPanelControl;

  NSObject  *callback;
  SEL  callbackSelector; 
}

// Overrides designated initialiser.
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithProgressPanel:(ProgressPanelControl *)progressPanel
                              callback:(NSObject *)callback
                              selector:(SEL)selector NS_DESIGNATED_INITIALIZER;
         
- (void) taskDone:(id)result;

@end // @interface CallbackHandler


@implementation VisibleAsynchronousTaskManager

- (instancetype) initWithProgressPanel:(ProgressPanelControl *)panelControl {
  if (self = [super init]) {
    progressPanelControl = [panelControl retain];
    
    taskManager = [[AsynchronousTaskManager alloc] initWithTaskExecutor:
                   progressPanelControl.taskExecutor];

    [NSNotificationCenter.defaultCenter addObserver: self
                                           selector: @selector(notificationFired:)
                                               name: nil
                                             object: taskManager];
  }

  return self;
}

- (void) dealloc {
  [taskManager release];
  [progressPanelControl release];

  [super dealloc];
}

- (void) dispose {
  NSAssert( taskManager != nil, @"TaskManager already nil.");
  [taskManager dispose];

  // Set it to "nil" to prevent it from being disposed once more.
  [taskManager release];
  taskManager = nil;
}


- (void) abortTask {
  [taskManager abortTask];
}


- (void) asynchronouslyRunTaskWithInput:(id)input
                               callback:(NSObject *)callback
                               selector:(SEL)selector {
  // Show the progress panel and let its Cancel button abort the task.
  [progressPanelControl taskStartedWithInput: input
                              cancelCallback: taskManager
                                    selector: @selector(abortTask) ];

  CallbackHandler  *callbackHandler = 
    [[[CallbackHandler alloc] initWithProgressPanel: progressPanelControl
                                           callback: callback
                                           selector: selector] autorelease];

  // Let callback go through handler object, so that progress panel is also closed.
  [taskManager asynchronouslyRunTaskWithInput: input 
                                     callback: callbackHandler
                                     selector: @selector(taskDone:)];
}

@end // @implementation VisibleAsynchronousTaskManager


@implementation VisibleAsynchronousTaskManager (PrivateMethods)

- (void) notificationFired:(NSNotification *)notification {
  [NSNotificationCenter.defaultCenter postNotificationName: notification.name object: self];
}

@end // @implementation VisibleAsynchronousTaskManager (PrivateMethods)


@implementation CallbackHandler

- (instancetype) initWithProgressPanel:(ProgressPanelControl *)panelControl
                              callback:(NSObject *)callbackVal
                              selector:(SEL)selector {

  if (self = [super init]) {
    progressPanelControl = [panelControl retain];
    callback = [callbackVal retain];
    callbackSelector = selector;
  }
  
  return self;
}

- (void) dealloc {
  [progressPanelControl release];
  [callback release];
  
  [super dealloc];
}

- (void) taskDone:(id)result {
  [progressPanelControl taskStopped];
  
  [callback performSelector: callbackSelector withObject: result];
}

@end // @implementation CallbackHandler
