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


/* Maintains a set of objects for re-use (mainly to optimize performance). The objects should be
 * (relatively) expensive to create, and be re-usable, i.e. their state must be reset-able to their
 * initial state.
 *
 * This class should be overridden to implement the methods for creating new objects, and resetting
 * existing ones.
 */
@interface ObjectPool : NSObject {
  int  maxSize;
  NSMutableArray  *pool;
}

/* Creates a pool with an unlimited capacity.
 */
- (instancetype) init;

/* Creates a pool with the given maximum size. It will never hold more than "maxSize" objects.
 */
- (instancetype) initWithCapacity:(int) maxSize NS_DESIGNATED_INITIALIZER;


/* Gets an object. It returns an object from the pool if it is non-empty. Otherwise it creates a new
 * object.
 */
- (id) borrowObject;

/* Returns an object to the pool.
 */
- (void) returnObject: (id) object;

@end


@interface ObjectPool (ProtectedMethods) 

/* Creates a new object that can be lent out by the pool. 
 *
 * Override this to return a properly initialised object of the right class.
 */
- (id) createObject;

/* Resets the object, so that it is ready for re-use.
 */
- (id) resetObject:(id)object;

@end
