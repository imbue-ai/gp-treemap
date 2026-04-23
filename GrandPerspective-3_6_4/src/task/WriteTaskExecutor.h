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

#import "TaskExecutor.h"

@class TreeWriter;

@interface WriteTaskExecutor : NSObject <TaskExecutor> {
  TreeWriter  *treeWriter;
  
  NSLock  *taskLock;
}

/* Returns a dictionary with info about the progress of the write task that is currently being
 * executed (or nil if there is none). The keys in the dictionary are those used by ProgressTracker.
 */
@property (nonatomic, readonly, copy) NSDictionary *progressInfo;

/* Abstract method that should create the tree writer to use.
 */
- (TreeWriter *)createTreeWriter;

@end

@interface RawWriteTaskExecutor : WriteTaskExecutor {
}

/* Creates a RawTreeWriter.
 */
- (TreeWriter *)createTreeWriter;

@end

@interface XmlWriteTaskExecutor : WriteTaskExecutor {
}

/* Creates an XmlTreeWriter.
 */
- (TreeWriter *)createTreeWriter;

@end
