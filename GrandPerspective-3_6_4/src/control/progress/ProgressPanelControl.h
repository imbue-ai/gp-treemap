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

@interface ProgressPanelControl : NSWindowController {
  IBOutlet NSProgressIndicator  *progressIndicator;
  IBOutlet NSTextField  *progressDetails;
  IBOutlet NSTextField  *progressSummary;

  NSString  *summaryToolTip;
  NSToolTipTag  summaryToolTipTag;

  NSTimeInterval  refreshRate;

  BOOL  taskRunning;
  NSObject <TaskExecutor>  *taskExecutor;

  NSObject  *cancelCallback;
  SEL  cancelCallbackSelector;
}

// Override designated initialisers
- (instancetype) initWithWindow:(NSWindow *)window NS_UNAVAILABLE;
- (instancetype) initWithCoder:(NSCoder *)coder NS_UNAVAILABLE;

- (instancetype) initWithTaskExecutor:(NSObject <TaskExecutor> *)taskExecutor NS_DESIGNATED_INITIALIZER;


@property (nonatomic, readonly, strong) NSObject<TaskExecutor> *taskExecutor;


/* Signals that a task has started execution. It also provides the callback method that should be
 * called when the task execution finished. The panel itself is notified about this by way of its
 * -taskStopped method.
 *
 * It should be called from main thread.
 */
- (void) taskStartedWithInput:(id)taskInput
               cancelCallback:(NSObject *)callback
                     selector:(SEL)selector;

/* Callback method. It should be called when the task has stopped executing, either because it
 * finished, or because it was aborted.
 *
 * It should be called from main thread.
 */
- (void) taskStopped;

/* Aborts the task (if it is still ongoing).
 */
- (IBAction) abort:(id)sender;

@end


@interface ProgressPanelControl (AbstractMethods)

@property (nonatomic, readonly, copy) NSString *windowTitle;
@property (nonatomic, readonly, copy) NSString *progressDetailsFormat;
@property (nonatomic, readonly, copy) NSString *progressSummaryFormat;

- (NSString *)pathFromTaskInput:(id)taskInput;
@property (nonatomic, readonly, copy) NSDictionary *progressInfo;

@end
