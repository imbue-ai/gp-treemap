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

#import "ScanTaskExecutor.h"

#import "TreeBuilder.h"
#import "TreeRefresher.h"
#import "ScanTaskInput.h"
#import "ScanTaskOutput.h"
#import "ProgressTracker.h"


@implementation ScanTaskExecutor

- (instancetype) init {
  if (self = [super init]) {
    taskLock = [[NSLock alloc] init];
    treeBuilder = nil;
  }
  return self;
}

- (void) dealloc {
  [taskLock release];
  
  NSAssert(treeBuilder == nil, @"treeBuilder should be nil.");
  
  [super dealloc];
}


- (void) prepareToRunTask {
  // Can be ignored because a one-shot object is used for running the task.
}

- (id) runTaskWithInput:(id)input {
  NSAssert(treeBuilder == nil, @"treeBuilder already set.");

  ScanTaskInput  *myInput = input;

  [taskLock lock];
  if (myInput.treeSource != nil) {
    // The scan is only partial
    treeBuilder = [[TreeRefresher alloc] initWithFilterSet: myInput.filterSet
                                                   oldTree: myInput.treeSource];
  } else {
    treeBuilder = [[TreeBuilder alloc] initWithFilterSet: myInput.filterSet];
  }
  [treeBuilder setFileSizeMeasure: myInput.fileSizeMeasure];
  [taskLock unlock];
  
  NSDate  *startTime = [NSDate date];
  
  TreeContext*  scanTree = [treeBuilder buildTreeForPath: myInput.path];
  ScanTaskOutput  *scanResult = nil;

  if (scanTree != nil) {
    NSLog(@"Done scanning: %d folders scanned (%d skipped) in %.2fs.",
            [self.progressInfo[NumFoldersProcessedKey] intValue],
            [self.progressInfo[NumFoldersSkippedKey] intValue],
            -startTime.timeIntervalSinceNow);
    scanResult = [ScanTaskOutput scanTaskOutput: scanTree alert: treeBuilder.alertMessage];
  }
  else {
    if (treeBuilder.alertMessage != nil) {
      NSLog(@"Scanning failed.");
      scanResult = [ScanTaskOutput failedScanTaskOutput: treeBuilder.alertMessage];
    } else {
      NSLog(@"Scanning aborted.");
    }
  }

  [taskLock lock];
  [treeBuilder release];
  treeBuilder = nil;
  [taskLock unlock];

  return scanResult;
}

- (void) abortTask {
  [treeBuilder abort];
}


- (NSDictionary *)progressInfo {
  NSDictionary  *dict;

  [taskLock lock];
  // The "taskLock" ensures that when treeBuilder is not nil, the object will
  // always be valid when it is used (i.e. it won't be deallocated).
  dict = treeBuilder.progressInfo;
  [taskLock unlock];
  
  return dict;
}

@end
