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

#import "TreeBalancer.h"

#import "Item.h"
#import "CompoundItem.h"
#import "PeekingEnumerator.h"

@implementation TreeBalancer

+ (dispatch_queue_t)dispatchQueue {
  static dispatch_queue_t  queue;
  static dispatch_once_t  onceToken;

  dispatch_once(&onceToken, ^{
    queue = dispatch_queue_create("net.sourceforge.grandperspectiv.TreeBalancer",
                                  DISPATCH_QUEUE_SERIAL);
  });

  return queue;
}


- (instancetype) init {
  if (self = [super init]) {
    compoundItems = [[NSMutableArray alloc] initWithCapacity: 1024];
    itemArray = [[NSMutableArray alloc] initWithCapacity: 1024];
  }
  
  return self;
}

- (void) dealloc {
  [compoundItems release];
  [itemArray release];

  [super dealloc];
}


- (Item *)convertLinkedListToTree:(Item *)items {
  if (items == nil || !items.virtual) {
    // Handle zero or one item here (so that rest of code knows there's at least one CompoundItem)
    return items;
  }

  // Copy CompoundItems to separate array, for later re-use.
  // Also copy actual file items to item array, for sorting.
  NSAssert(compoundItems != nil && compoundItems.count == 0, @"Temporary array not valid." );
  NSAssert(itemArray != nil && itemArray.count == 0, @"Temporary array not valid." );

  Item  *item = items;
  while (item.isVirtual) {
    CompoundItem  *compoundItem = (CompoundItem *)item;
    [compoundItems addObject: compoundItem];
    [itemArray addObject: compoundItem.first];
    item = compoundItem.second;
  }
  [itemArray addObject: compoundItems.lastObject.second];

  [itemArray sortUsingComparator: ^(Item *item1, Item *item2) {
    if (item1.itemSize < item2.itemSize) {
      return NSOrderedAscending;
    }
    if (item1.itemSize > item2.itemSize) {
      return NSOrderedDescending;
    }
    return NSOrderedSame;
  }];

  // Not using auto-release to minimise size of auto-release pool (and to enable running in
  // dispatch queue without auto-release pool).
  PeekingEnumerator  *sortedItems =
    [[PeekingEnumerator alloc] initWithEnumerator: itemArray.objectEnumerator];

  // The index from where to get the next uninitialized Compound Item
  int  i = 0;
  // The index from where to get the first initialized but orphaned Compound Item (when j < i)
  int  j = 0;

  while (YES) {
    Item  *first = nil;
    Item  *second = nil;

    while (second == nil) {
      Item*  smallest;

      if (
        // Out of leafs, or
        sortedItems.peekObject == nil || (
          // orphaned branches exist, and the branch is smaller
          j < i && compoundItems[j].itemSize < ((Item *)sortedItems.peekObject).itemSize
        )
      ) {
        if (j < i) {
          smallest = compoundItems[j++];
        } else {
          // We're finished building the tree

          // As zero-sized items are excluded, first can actually be nil but that is okay.
          [first retain];

          // Clean up
          [itemArray removeAllObjects];
          [compoundItems removeAllObjects];
          [sortedItems release];

          return [first autorelease];
        }
      } else {
        smallest = [sortedItems nextObject];
      }
      NSAssert(smallest != nil, @"Smallest is nil.");

      if (first == nil) {
        first = smallest;
      } else {
        second = smallest;
      }
    }

    [compoundItems[i++] replaceFirst: first second: second];
  }
}

@end // @implementation TreeBalancer
