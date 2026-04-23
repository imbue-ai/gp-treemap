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

#import "MutableArrayPool.h"


@implementation MutableArrayPool

// Overrides designated initialiser.
- (instancetype) initWithCapacity:(int)maxSizeVal {
  return [self initWithCapacity: maxSizeVal initialArrayCapacity: 16];
}

- (instancetype) initWithCapacity:(int)maxSizeVal
             initialArrayCapacity:(int)initialArraySize {
  if (self = [super initWithCapacity: maxSizeVal]) {
    initialArrayCapacity = initialArraySize;
  }
  
  return self;
}


- (id) createObject {
  return [NSMutableArray arrayWithCapacity: initialArrayCapacity];
}

- (id) resetObject:(id)object {
  [object removeAllObjects];
  return object;
}

@end
