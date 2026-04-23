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

#import "Item.h"

#import "PreferencesPanelControl.h"

@implementation Item

// Overrides super's designated initialiser.
- (instancetype) init {
  return [self initWithItemSize:0];
}

- (instancetype) initWithItemSize:(item_size_t)itemSize {
  if (self = [super init]) {
    _itemSize = itemSize;
  }
  
  return self;
}

- (void) visitFileItemDescendants:(void(^)(FileItem *))callback {
  NSAssert(NO, @"Abstract method");
}

- (FileItem *)findFileItemDescendant:(BOOL(^)(FileItem *))predicate {
  NSAssert(NO, @"Abstract method");
  return nil;
}

- (file_count_t) numFiles {
  return 0;
}

- (void) setItemSize:(item_size_t)itemSize {
  // Disabled check below as CompoundItem replaceFirst:second now violates it (by design)
  // NSAssert(_itemSize == 0, @"Cannot change itemSize after it has been set");

  _itemSize = itemSize;
}

- (BOOL) isVirtual {
  return NO;
}

- (NSString *)description {
  return [NSString stringWithFormat:@"Item(size=%qu)", self.itemSize];
}

@end
