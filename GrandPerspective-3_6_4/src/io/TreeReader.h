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

@class FilterTestRepository;
@class AnnotatedTreeContext;
@class TreeBalancer;
@class ReadProgressTracker;
@class CompressedInput;

@interface TreeReader : NSObject <NSXMLParserDelegate> {

  FilterTestRepository  *testRepository;

  NSXMLParser  *parser;
  AnnotatedTreeContext  *tree;
  int  formatVersion;

  BOOL  abort;
  NSError  *error;
  
  NSMutableArray  *unboundTests;

  // Parsing datetime strings is slow. There are typically also many duplicate values. Using a
  // cache speeds up parsing by about a factor ten.
  NSMutableDictionary  *timeCache;

  CompressedInput  *decompressor;
  ReadProgressTracker  *progressTracker;
  TreeBalancer  *treeBalancer;

  NSAutoreleasePool  *autoreleasePool;
}

- (instancetype) init;
- (instancetype) initWithFilterTestRepository:(FilterTestRepository *)repository NS_DESIGNATED_INITIALIZER;

/* Reads the tree from a file in scan dump format. Returns the annotated tree context when
 * successful. The tree can then later be retrieved using -annotatedTreeContext. Returns nil if
 * reading is aborted, or if there is an error. In the latter case, the error can be retrieved
 * using -error.
 */
- (AnnotatedTreeContext *)readTreeFromFile:(NSURL *)url;

/* Aborts reading (when it is carried out in a different execution thread). 
 */
- (void) abort;

/* Returns YES iff the reading task was aborted externally (i.e. using -abort).
 */
@property (nonatomic, readonly) BOOL aborted;

/* Returns the tree that was read.
 */
@property (nonatomic, readonly, strong) AnnotatedTreeContext *annotatedTreeContext;

/* Returns details of the error iff there was an error when carrying out the reading task.
 */
@property (nonatomic, readonly, copy) NSError *error;

/* Returns the names of any unbound filter tests, i.e. tests that could not be found in the test
 * repository.
 */
@property (nonatomic, readonly, copy) NSArray *unboundFilterTests;

/* Returns a dictionary containing information about the progress of the ongoing tree-reading task.
 *
 * It can safely be invoked from a different thread than the one that invoked -readTreeFromFile:
 * (and not doing so would actually be quite silly).
 */
@property (nonatomic, readonly, copy) NSDictionary *progressInfo;

@property (nonatomic) int formatVersion;

@end
