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

#import "NotifyingDictionary.h"


NSString  *ObjectAddedEvent = @"objectAdded";
NSString  *ObjectRemovedEvent = @"objectRemoved";
NSString  *ObjectUpdatedEvent = @"objectUpdated";
NSString  *ObjectRenamedEvent = @"objectRenamed";


// For checking which methods are safe to invoke on the dictionary (i.e. which won't mutate it).
static NSDictionary  *immutableDict = nil;


@implementation NotifyingDictionary

// Overrides designated initialiser
- (instancetype) init {
  return [self initWithCapacity:32];
}

- (instancetype) initWithCapacity:(unsigned)capacity {
  return [self initWithCapacity: capacity initialContents: nil];
}

- (instancetype) initWithCapacity:(unsigned)capacity
                  initialContents:(NSDictionary *)contents {
  if (self = [super init]) {
    if (immutableDict == nil) {
      // Static initialisation
      immutableDict = [[NSDictionary alloc] init];
    }

    dict = [[NSMutableDictionary alloc] initWithCapacity: capacity];
    
    if (contents != nil) {
      [dict addEntriesFromDictionary: contents];
    }
    
    notificationCenter = [NSNotificationCenter.defaultCenter retain];
  }
  
  return self;
}

- (void) dealloc {
  [dict release];
  [notificationCenter release];
  
  [super dealloc];
}


- (NSNotificationCenter*) notificationCenter {
  return notificationCenter;
}
  
- (void) setNotificationCenter:(NSNotificationCenter *)notificationCenterVal {
  if (notificationCenterVal != notificationCenter) {
    [notificationCenter release];
    notificationCenter = [notificationCenterVal retain];
  }
}


- (BOOL) addObject:(id)object forKey:(id)key {
  if (dict[key] != nil) {
    return NO;
  }
  else {
    dict[key] = object;
    [notificationCenter postNotificationName: ObjectAddedEvent
                                      object: self
                                    userInfo: @{@"key": key}];
    return YES;
  }
}

- (BOOL) removeObjectForKey:(id)key {
  if (dict[key] == nil) {
    return NO;
  }
  else {
    [dict removeObjectForKey: key];
    [notificationCenter postNotificationName: ObjectRemovedEvent
                                      object: self
                                    userInfo: @{@"key": key}];
    return YES;
  }
}

- (BOOL) updateObject:(id)object forKey:(id)key {
  id  oldObject = dict[key];
  if (oldObject == nil) {
    return NO;
  }
  else {
    if (oldObject != object) {
      // Object (reference) changed.
      dict[key] = object;
    }
    
    // Fire notification even when reference stayed the same. Object may have
    // been internally modified.
    [notificationCenter postNotificationName: ObjectUpdatedEvent
                                      object: self
                                    userInfo: @{@"key": key}];
    return YES;
  }
}

- (BOOL) moveObjectFromKey:(id)oldKey toKey:(id)newKey {
  id  object = dict[oldKey];
  if (object == nil || dict[newKey] != nil) {
    return NO;
  }
  else {
    [dict removeObjectForKey: oldKey];
    dict[newKey] = object;
    [notificationCenter postNotificationName: ObjectRenamedEvent
                                      object: self
                                    userInfo: @{@"oldkey": oldKey, @"newkey": newKey}];
    return YES;
  }
}


- (NSMethodSignature *)methodSignatureForSelector:(SEL)sel {
  NSMethodSignature  *sig = [[self class] instanceMethodSignatureForSelector: sel];

  if (sig == nil) {
    sig = [immutableDict methodSignatureForSelector:sel];
  }
  NSAssert(sig != nil, @"Selector not supported by class or wrapped class."); 
  return sig;
}

- (void)forwardInvocation:(NSInvocation *)inv {
  if ([immutableDict respondsToSelector: inv.selector]) {
    // Note: testing on "immutableDict", but invoking on "dict"
    [inv invokeWithTarget: dict];
  }
  else {
    [super forwardInvocation: inv];
  }
}

@end
