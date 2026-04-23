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

#import "FilterTaskExecutor.h"

#import "TreeFilter.h"
#import "FilterTaskInput.h"
#import "TreeContext.h"
#import "FilterSet.h"


@implementation FilterTaskExecutor

- (instancetype) init {
  if (self = [super init]) {
    taskLock = [[NSLock alloc] init];
    treeFilter = nil;
  }
  return self;
}

- (void) dealloc {
  [treeFilter release];
  
  [super dealloc];
}


- (void) prepareToRunTask {
  // Can be ignored because a one-shot object is used for running the task.
}

- (id) runTaskWithInput:(id)input {
  NSAssert( treeFilter==nil, @"treeFilter already set.");
  
  FilterTaskInput  *filterInput = input;
  
  [taskLock lock];
  treeFilter = [[TreeFilter alloc] initWithFilterSet: filterInput.filterSet];
  [taskLock unlock];
    
  TreeContext  *originalTree = filterInput.treeContext;
  [originalTree obtainReadLock];

  TreeContext  *filteredTree = [treeFilter filterTree: originalTree];
                         
  [originalTree releaseReadLock];
  
  [taskLock lock];
  [treeFilter release];
  treeFilter = nil;
  [taskLock unlock];
  
  return filteredTree;
}

- (void) abortTask {
  [treeFilter abort];
}


- (NSDictionary *)progressInfo {
  NSDictionary  *dict;

  [taskLock lock];
  // The "taskLock" ensures that when treeFilter is not nil, the object will
  // always be valid when it is used (i.e. it won't be deallocated).
  dict = treeFilter.progressInfo;
  [taskLock unlock];
  
  return dict;
}

@end
