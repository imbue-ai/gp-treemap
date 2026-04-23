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

#import "BasicFileItemTestVisitor.h"


/* Simple visitor that can be used to check if a (compound) FileItemTest contains an ItemSizeTest as
 * one of its subtests.
 */
@interface ItemSizeTestFinder : BasicFileItemTestVisitor {
}

/* Resets the finder so that it can be used on a new test.
 */
- (void) reset;

/* Returns YES if an ItemSizeTest has been encountered. It should be called after the finder has
 * "visited" the FileItemTest for which it should determine whether or not the test includes an
 * ItemSizeTest.
 */
@property (nonatomic, readonly) BOOL itemSizeTestFound;

@end
