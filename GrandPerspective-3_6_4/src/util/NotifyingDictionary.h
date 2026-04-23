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


extern NSString  *ObjectAddedEvent;
extern NSString  *ObjectRemovedEvent;
extern NSString  *ObjectUpdatedEvent;
extern NSString  *ObjectRenamedEvent;


@interface NotifyingDictionary : NSObject {
  NSMutableDictionary  *dict;
  NSNotificationCenter  *notificationCenter;
}

- (instancetype) initWithCapacity:(unsigned)capacity;

- (instancetype) initWithCapacity:(unsigned)capacity
                  initialContents:(NSDictionary *)contents NS_DESIGNATED_INITIALIZER;


@property (nonatomic, strong) NSNotificationCenter *notificationCenter;


/* Adds the object to the dictionary.
 *
 * Returns "YES" if the operation succeeded, and fires an ObjectAddedEvent notification. The key is
 * available in the userInfo under the "key" string.
 *
 * Returns "NO" if the operation failed (because an object for this key already existed).
 */
- (BOOL) addObject:(id)object forKey:(id)key;

/* Removes the object from the dictionary.
 *
 * Returns "YES" if the operation succeeded, and fires an ObjectRemovedEvent notification. The key
 * is available in the userInfo under the "key" string.
 *
 * Returns "NO" if the operation failed (because no object was stored under the given key.
 */
- (BOOL) removeObjectForKey:(id)key;

/* Updates the object in the dictionary.
 *
 * Returns "YES" if the operation succeeded, and fires an ObjectUpdatedEvent notification. The key
 * is available in the userInfo under the "key" string.
 *
 * Returns "NO" if the operation failed (because no object was stored under the given key.
 *
 * Note: You should also call this method if object reference stored under key did not change, but
 * the object itself did (because it was mutable). Otherwise interested observers will be unaware
 * of the change.
 */
- (BOOL) updateObject:(id)object forKey:(id)key;

/* Moves the object in the dictionary to a different key. It is assumed that the object itself did
 * not change. If it did, you should also invoke updateObject:forKey:.
 *
 * Returns "YES" if the operation succeeded, and fires an ObjectRenamedEvent notification. The old
 * key is available in the userInfo under the "oldkey" string, and the new key similarly under the
 * "newkey" string.
 *
 * Returns "NO" if the operation failed (because no object was stored under the old key, or another
 * object was already stored under the new key).
 */
- (BOOL) moveObjectFromKey:(id)oldKey toKey:(id)newKey;

// Note: you can also call on this object any methods specific to NSDictionary. 

@end
