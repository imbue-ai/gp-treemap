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

#import "ObjectPool.h"


@implementation ObjectPool

/* Creates a pool with an unlimited maximum size.
 */
- (instancetype) init {
  return [self initWithCapacity: INT_MAX];
}

- (instancetype) initWithCapacity:(int)maxSizeVal {
  if (self = [super init]) {
    maxSize = maxSizeVal;
    
    pool = [[NSMutableArray alloc] initWithCapacity: MIN(16, maxSizeVal)];
  }
  
  return self;
}

- (void) dealloc {
  [pool release];
  
  [super dealloc];
}


- (id) borrowObject {
  if (pool.count > 0) {
    id  obj = [[pool.lastObject retain] autorelease];
    [pool removeLastObject];

    return obj;
  }
  else {
    return [self createObject];
  }
}

- (void) returnObject:(id)object {
  if (pool.count < maxSize) {
    [pool addObject: [self resetObject: object]];
  }
}

@end
