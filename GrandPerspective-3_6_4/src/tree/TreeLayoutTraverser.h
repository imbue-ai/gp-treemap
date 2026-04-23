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

@class Item;


/* Protocol implemented by objects that need to "traverse" the tree-map layout built by the
 * TreeLayoutBuilder. TreeLayoutTraversers can dynamically indicate which parts of the layout need
 * to be built.
 */
@protocol TreeLayoutTraverser

/* Called to signal that the given item is layed out at the given rectangle.
 *
 * The depth is the number of sub-directories between the given item and the part of the tree where
 * the traversal started (notnecessarily the root of the tree). It is passed as a matter of
 * convenience, for traversers that like to use it.
 *
 * The callee should return YES iff traversal should continue within the given rectangle.
 */
- (BOOL) descendIntoItem:(Item *)item atRect:(NSRect)rect depth:(int)depth;

/* Called to signal that traversal within the given item has been completed. It is only called for
 * item's for which the earlier invocation of descendIntoItem:atRect:depth returned YES.
 */
- (void) emergedFromItem:(Item *)item;

@end
