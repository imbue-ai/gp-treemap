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

#import "ProgressPanelControl.h"

#import "PreferencesPanelControl.h"


extern NSString  *NumFoldersProcessedKey;
extern NSString  *CurrentFolderPathKey;
extern NSString  *EstimatedProgressKey;
extern NSString  *StableFolderPathKey;


@interface ProgressPanelControl (PrivateMethods)

- (void) updatePanel;

- (void) updateProgressDetails:(NSString *)currentPath;
- (void) updateProgressSummary:(int)numProcessed;
- (void) updateProgressEstimate:(float)progressEstimate;

@end


@implementation ProgressPanelControl

- (instancetype) initWithTaskExecutor:(NSObject <TaskExecutor> *)taskExecutorVal {
  if (self = [super initWithWindow: nil]) {
    taskExecutor = [taskExecutorVal retain];

    refreshRate = [NSUserDefaults.standardUserDefaults floatForKey: ProgressPanelRefreshRateKey];
    if (refreshRate <= 0) {
      NSLog(@"Invalid value for progressPanelRefreshRate.");
      refreshRate = 1;
    }
  }
  
  return self;
}


- (void) dealloc {
  [taskExecutor release];
  [summaryToolTip release];

  NSAssert(cancelCallback==nil, @"cancelCallback not nil.");
  
  [super dealloc]; 
}


- (NSString *)windowNibName {
  return @"ProgressPanel";
}

- (void) windowDidLoad {
  if (@available(macOS 10.11, *)) {
    self->progressSummary.font = [NSFont monospacedDigitSystemFontOfSize: 0
                                                                  weight: NSFontWeightRegular];
  }

  summaryToolTip = nil;
  summaryToolTipTag = 0;

  [self updateProgressDetails: @""];
  [self updateProgressSummary: 0];

  self.window.title = self.windowTitle;
}


- (NSObject <TaskExecutor> *)taskExecutor {
  return taskExecutor;
}


- (void) taskStartedWithInput:(id)taskInput
               cancelCallback:(NSObject *)callback
                     selector:(SEL)selector {
  NSAssert(cancelCallback == nil, @"Callback already set.");
  
  cancelCallback = [callback retain];
  cancelCallbackSelector = selector;

  // Update title. It may change depending on task input
  self.window.title = self.windowTitle;

  [self.window center];
  [self.window orderFront: self];

  [self updateProgressDetails: [self pathFromTaskInput: taskInput]];
  [self updateProgressSummary: 0];
  [self updateProgressEstimate: 0];

  taskRunning = YES;
  [self updatePanel];
}

- (void) taskStopped {
  NSAssert(cancelCallback != nil, @"Callback already nil.");
  
  [cancelCallback release];
  cancelCallback = nil;
  
  [self.window close];

  taskRunning = NO; 
}


- (IBAction) abort:(id)sender {
  [cancelCallback performSelector: cancelCallbackSelector];
 
  // No need to invoke "taskStopped". This is the responsibility of the caller of "taskStarted".
}

@end // @implementation ProgressPanelControl


@implementation ProgressPanelControl (PrivateMethods)

- (void) updatePanel {
  if (!taskRunning) {
    return;
  }

  NSDictionary  *dict = [self progressInfo];
  if (dict != nil) {
    [self updateProgressDetails: dict[StableFolderPathKey]];
    [self updateProgressSummary: [dict[NumFoldersProcessedKey] intValue]];
    [self updateProgressEstimate: [dict[EstimatedProgressKey] floatValue]];
  }

  // Schedule another update
  [self performSelector: @selector(updatePanel) withObject: 0 afterDelay: refreshRate];
}

- (void) updateProgressDetails:(NSString *)currentPath {
  progressDetails.stringValue =
    (currentPath != nil)
    ? [NSString stringWithFormat: self.progressDetailsFormat, currentPath]
    : @"";

  // Update the tooltip only when the summary changed. This ensures that the tooltip shows up when
  // the mouse hovers over the control while the path stays the same for long enough.
  if (![summaryToolTip isEqualToString: progressDetails.stringValue]) {
    NSView* view = progressDetails.superview;
    if (summaryToolTip != nil) {
      [summaryToolTip release];
      [view removeToolTip: summaryToolTipTag];
    }

    summaryToolTip = [progressDetails.stringValue retain];
    summaryToolTipTag = [view addToolTipRect: progressDetails.frame
                                       owner: summaryToolTip
                                    userData: nil];
  }
}

- (void) updateProgressSummary:(int)numProcessed {
  progressSummary.stringValue =
    [NSString localizedStringWithFormat: self.progressSummaryFormat, numProcessed];
}

- (void) updateProgressEstimate:(float)progressEstimate {
  progressIndicator.doubleValue = progressEstimate;
}

@end // @implementation ProgressPanelControl (PrivateMethods)


