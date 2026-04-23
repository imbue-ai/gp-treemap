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
@class CompoundItem;

@interface TreeBalancer : NSObject {

@private
  // Temporary arrays
  NSMutableArray<CompoundItem *>  *compoundItems;
  NSMutableArray<Item *>  *itemArray;
}

+ (dispatch_queue_t)dispatchQueue;

// Balance tree with as input the items passed via a linked list of CompoundItems. These
// CompoundItems are re-used to create the balanced tree. This is a way to pass the request to
// another thread without requiring temporary storage whose ownership needs transferring (so it
// cannot be re-used without additional synchronization)
- (Item *)convertLinkedListToTree:(Item *)items;

@end
