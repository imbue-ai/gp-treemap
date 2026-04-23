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

#import "Item.h"

@class FileItem;

NS_ASSUME_NONNULL_BEGIN

@interface CompoundItem : Item {
  file_count_t  numFiles;
}

- (instancetype) initWithItemSize:(item_size_t)size NS_UNAVAILABLE;

/* Both items must be non-nil.
 */
- (instancetype) initWithFirst:(Item *)first
                        second:(Item *)second NS_DESIGNATED_INITIALIZER;

/* Replaces the contents of the compound-item.
 *
 * Note: Unlike the individual replace methods, the size of the item may change. That implies
 * that this method should only be used on items that are not yet part of a balanced tree (as this
 * may "upset" the balance)
 */
- (void) replaceFirst:(Item *)newFirst second:(Item *)newSecond;

@property (nonatomic, readonly, strong) Item *first;

@property (nonatomic, readonly, strong) Item *second;

/* Replaces the first item. The item must have the same size as the original one (otherwise the
 * resulting tree would be incorrect).
 *
 * Note: It is the responsibility of the sender to ensure that this method is only called when the
 * tree can be modified (e.g. it should not be traversed in another thread). Furthermore, the sender
 * is responsible for notifying objects affected by the change.
 */
- (void) replaceFirst:(Item *)newItem;

// Replaces the second item. See also -replaceFirst.
- (void) replaceSecond:(Item *)newItem;

/* Can handle case where either one or both are nil. If both are nil, it returns nil. If one item is
 * nil, it returns the other item. Otherwise it returns a CompoundItem containing both.
 */
+ (nullable Item *)compoundItemWithFirst:(nullable Item *)first second:(nullable Item *)second;

/* Visits FileItem leave nodes until it finds one for which the predicate applies. It then return
 * the given item, and returns nil otherwise.
 *
 * It handles the case where item is a CompoundItem (the typical case), but also accepts single
 * item trees where the root is a FileItem.
 *
 * Note: It does not recurse into DirectoryItem nodes. For this, use -findFileItemDescendant
 * instead.
 */
+ (nullable FileItem *)findFileItemChild:(Item *)item predicate:(BOOL(^)(FileItem *))predicate;
+ (nullable FileItem *)findFileItemChildMaybeNil:(nullable Item *)item
                                       predicate:(BOOL(^)(FileItem *))predicate;

/* Visits all FileItem leave nodes in the tree with "item" at the root and applies the callback on
 * each.
 *
 * It handles the case where item is a CompoundItem (the typical case), but also accepts single
 * item trees where the root is a FileItem.
 *
 * Note: It does not recurse into DirectoryItem nodes. For this, use -visitFileItemDescendants
 * instead.
 */
+ (void)visitFileItemChildren:(Item *)item callback:(void(^)(FileItem *))callback;
+ (void)visitFileItemChildrenMaybeNil:(nullable Item *)item callback:(void(^)(FileItem *))callback;

@end

NS_ASSUME_NONNULL_END
