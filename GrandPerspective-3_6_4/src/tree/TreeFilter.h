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


@class FilterSet;
@class FilteredTreeGuide;
@class TreeBalancer;
@class TreeContext;
@class ProgressTracker;


@interface TreeFilter : NSObject {
  FilterSet  *filterSet;

  FilteredTreeGuide  *treeGuide;
  TreeBalancer  *treeBalancer;

  BOOL  abort;
  
  ProgressTracker  *progressTracker;
}

// Overrides super's designated initialiser.
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithFilterSet:(FilterSet *)filterSet NS_DESIGNATED_INITIALIZER;


/* Filters the tree. Omits all items from the old tree that should not be descended into according
 * to the filtered tree guide.
 */
- (TreeContext *)filterTree:(TreeContext *)oldTree;

/* Aborts filtering (when it is carried out in a different execution thread). 
 */
- (void) abort;

/* Returns a dictionary containing information about the progress of the ongoing tree-filtering
 * task.
 *
 * It can safely be invoked from a different thread than the one that invoked -filterTree: (and not
 * doing so would actually be quite silly).
 */
@property (nonatomic, readonly, copy) NSDictionary *progressInfo;

@end
