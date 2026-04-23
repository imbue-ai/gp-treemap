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

#import "FileItemTest.h"
#import "Item.h"

/* Item size test.
 */
@interface ItemSizeTest : FileItemTest  {
}

// Overrides designated initialiser.
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithLowerBound:(item_size_t)lowerBound;

- (instancetype) initWithUpperBound:(item_size_t)upperBound;

- (instancetype) initWithLowerBound:(item_size_t)lowerBound
                         upperBound:(item_size_t)upperBound NS_DESIGNATED_INITIALIZER;
- (instancetype) initWithPropertiesFromDictionary:(NSDictionary *)dict NS_DESIGNATED_INITIALIZER;

@property (nonatomic, readonly) BOOL hasLowerBound;
@property (nonatomic, readonly) BOOL hasUpperBound;

@property (nonatomic, readonly) unsigned long long lowerBound;
@property (nonatomic, readonly) unsigned long long upperBound;

+ (FileItemTest *)fileItemTestFromDictionary:(NSDictionary *)dict;

@end
