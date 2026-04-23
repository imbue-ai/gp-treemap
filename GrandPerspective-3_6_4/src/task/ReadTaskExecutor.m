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

#import "ReadTaskExecutor.h"

#import "TreeReader.h"
#import "ReadTaskInput.h"


@implementation ReadTaskExecutor

- (instancetype) init {
  if (self = [super init]) {
    taskLock = [[NSLock alloc] init];
    treeReader = nil;
  }
  return self;
}

- (void) dealloc {
  [taskLock release];
  
  NSAssert(treeReader == nil, @"treeReader should be nil.");
  
  [super dealloc];
}


- (void) prepareToRunTask {
  // Can be ignored because a one-shot object is used for running the task.
}

- (id) runTaskWithInput:(id)input {
  NSAssert(treeReader == nil, @"treeReader already set.");

  ReadTaskInput  *myInput = input;

  [taskLock lock];
  treeReader = [[TreeReader alloc] init];
  [taskLock unlock];

  [treeReader readTreeFromFile: myInput.sourceUrl];
  TreeReader  *retVal = [[treeReader retain] autorelease];

  [taskLock lock];
  [treeReader release];
  treeReader = nil;
  [taskLock unlock];

  // Return the TreeReader as next to the tree that is read, its -error and -unboundTests might be
  // of interest as well.
  return retVal;
}

- (void) abortTask {
  [treeReader abort];
}


- (NSDictionary *)progressInfo {
  NSDictionary  *dict;

  [taskLock lock];
  // The "taskLock" ensures that when treeReader is not nil, the object will always be valid when it
  // is used (i.e. it won't be deallocated).
  dict = treeReader.progressInfo;
  [taskLock unlock];
  
  return dict;
}

@end
