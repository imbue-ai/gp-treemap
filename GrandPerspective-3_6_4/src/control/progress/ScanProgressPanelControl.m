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

#import "ScanProgressPanelControl.h"

#import "ScanTaskExecutor.h"
#import "ScanTaskInput.h"
#import "TreeBuilder.h"


@implementation ScanProgressPanelControl

- (NSString *)windowTitle {
  return (refreshBasedScan
          ? NSLocalizedString(@"Refresh in progress", @"Title of progress panel.")
          : NSLocalizedString(@"Scanning in progress", @"Title of progress panel."));
}

- (NSString *)progressDetailsFormat {
  return NSLocalizedString(@"Scanning %@", @"Message in progress panel while scanning");
}

- (NSString *)progressSummaryFormat {
  return (refreshBasedScan
          ? NSLocalizedString(@"%d folders processed",
                              @"Message in progress panel while executing refresh-based scan")
          : NSLocalizedString(@"%d folders scanned",
                              @"Message in progress panel while executing a full scan"));
}

- (NSString *)pathFromTaskInput:(id)taskInput {
  return ((ScanTaskInput *)taskInput).path;
}

- (NSDictionary *)progressInfo {
  return ((ScanTaskExecutor *)taskExecutor).progressInfo;
}

// Overrides method in super class
- (void) taskStartedWithInput:(id)taskInput
               cancelCallback:(NSObject *)callback
                     selector:(SEL)selector {
  refreshBasedScan = ((ScanTaskInput *)taskInput).treeSource != nil;

  [super taskStartedWithInput: taskInput cancelCallback: callback selector: selector];
}

@end // @implementation ScanProgressPanelControl
