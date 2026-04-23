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

typedef unsigned long long item_size_t;
typedef unsigned long long file_count_t;

@class FileItem;

@interface Item : NSObject {
}


- (instancetype) initWithItemSize:(item_size_t)size NS_DESIGNATED_INITIALIZER;

/* Applies the callback to all file item descendants.
 */
- (void) visitFileItemDescendants:(void(^)(FileItem *))callback;

/* Returns the first file item descendant matching the predicate.
 */
- (FileItem *)findFileItemDescendant:(BOOL(^)(FileItem *))predicate;

/* Item size should not be changed once it is set. It is not "readonly" to enable DirectoryItem
 * subclass to set it later (once it knows its size).
 */
@property (nonatomic) item_size_t itemSize;
@property (nonatomic, readonly) file_count_t numFiles;

// An item is virtual if it is not a file item (i.e. a file or directory).
@property (nonatomic, getter=isVirtual, readonly) BOOL virtual;

@end
