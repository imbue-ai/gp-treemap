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

#import "AnnotatedTreeContext.h"

#import "TreeContext.h"

#import "FilterSet.h"
#import "FileItemTest.h"

@implementation AnnotatedTreeContext

+ (instancetype) annotatedTreeContext:(TreeContext *)treeContext {
  return (treeContext == nil 
          ? nil
          : [[[AnnotatedTreeContext alloc] initWithTreeContext: treeContext] autorelease]);
}

+ (instancetype) annotatedTreeContext:(TreeContext *)treeContext
                             comments:(NSString *)comments {
  return (treeContext == nil
          ? nil
          : [[[AnnotatedTreeContext alloc] initWithTreeContext: treeContext comments: comments]
             autorelease]);
}

- (instancetype) initWithTreeContext:(TreeContext *)treeContext {
  FileItemTest  *test = treeContext.filterSet.fileItemTest;

  return [self initWithTreeContext: treeContext
                          comments: ((test != nil) ? test.description : @"")];
}

- (instancetype) initWithTreeContext:(TreeContext *)treeContext
                            comments:(NSString *)comments {
  if (self = [super init]) {
    NSAssert(treeContext != nil, @"TreeContext must be set.");
  
    _treeContext = [treeContext retain];
    
    // Create a copy of the string, to ensure it is immutable.
    _comments = comments != nil ? [NSString stringWithString: comments] : @"";
    [_comments retain];
  }
  return self;
}

- (void) dealloc {
  [_treeContext release];
  [_comments release];

  [super dealloc];
}

@end
