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

#import "WriteProgressPanelControl.h"

#import "FileItem.h"
#import "DirectoryItem.h"
#import "WriteTaskExecutor.h"
#import "WriteTaskInput.h"
#import "TreeContext.h"
#import "AnnotatedTreeContext.h"


@implementation WriteProgressPanelControl

- (NSString *)windowTitle {
  return NSLocalizedString(@"Saving in progress", @"Title of progress panel.");
}

- (NSString *)progressDetailsFormat {
  return NSLocalizedString(@"Saving %@", @"Message in progress panel while saving data");
}

- (NSString *)progressSummaryFormat {
  return NSLocalizedString(@"%d folders saved", @"Message in progress panel while saving data");
}

- (NSString *)pathFromTaskInput:(id)taskInput {
  return ((WriteTaskInput *)taskInput).annotatedTreeContext.treeContext.scanTree.path;
}

- (NSDictionary *)progressInfo {
  return  ((WriteTaskExecutor *)taskExecutor).progressInfo;
}

@end
