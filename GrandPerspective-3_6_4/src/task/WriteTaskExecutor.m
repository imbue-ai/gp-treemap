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

#import "WriteTaskExecutor.h"

#import "RawTreeWriter.h"
#import "XmlTreeWriter.h"
#import "WriteTaskInput.h"


@implementation WriteTaskExecutor

- (instancetype) init {
  if (self = [super init]) {
    taskLock = [[NSLock alloc] init];
    treeWriter = nil;
  }
  return self;
}

- (void) dealloc {
  [taskLock release];
  
  NSAssert(treeWriter == nil, @"treeWriter should be nil.");
  
  [super dealloc];
}


- (TreeWriter *)createTreeWriter {
  NSAssert(NO, @"This method should be overridden.");
  return nil;
}


- (void) prepareToRunTask {
  // Can be ignored because a one-shot object is used for running the task.
}

- (id) runTaskWithInput:(id)input {
  NSAssert(treeWriter == nil, @"treeWriter already set.");

  WriteTaskInput  *myInput = input;

  [taskLock lock];
  treeWriter = [[self createTreeWriter] retain];
  [taskLock unlock];

  id  result = nil;
  if ([treeWriter writeTree: myInput.annotatedTreeContext
                     toFile: myInput.path
                    options: myInput.options]) {
    result = SuccessfulVoidResult;
  }
  else {
    result = [[treeWriter.error retain] autorelease]; // Will return nil when task was aborted
  }

  [taskLock lock];
  [treeWriter release];
  treeWriter = nil;
  [taskLock unlock];

  return result;
}

- (void) abortTask {
  [treeWriter abort];
}


- (NSDictionary *)progressInfo {
  NSDictionary  *dict;

  [taskLock lock];
  // The "taskLock" ensures that when treeWriter is not nil, the object will always be valid when
  // it is used (i.e. it won't be deallocated).
  dict = treeWriter.progressInfo;
  [taskLock unlock];
  
  return dict;
}

@end


@implementation RawWriteTaskExecutor

- (TreeWriter *)createTreeWriter {
  return [[[RawTreeWriter alloc] init] autorelease];
}

@end

@implementation XmlWriteTaskExecutor

- (TreeWriter *)createTreeWriter {
  return [[[XmlTreeWriter alloc] init] autorelease];
}

@end
