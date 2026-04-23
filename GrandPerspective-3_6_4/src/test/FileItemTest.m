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

#import "FileItemTest.h"

#import "FileItemTest.h"
#import "ItemNameTest.h"
#import "ItemPathTest.h"
#import "ItemSizeTest.h"
#import "ItemTypeTest.h"
#import "ItemFlagsTest.h"
#import "SelectiveItemTest.h"
#import "CompoundAndItemTest.h"
#import "CompoundOrItemTest.h"
#import "NotItemTest.h"


@implementation FileItemTest

+ (FileItemTest *)fileItemTestFromDictionary:(NSDictionary *)dict {
  NSString  *classString = dict[@"class"];
  
  if ([classString isEqualToString: @"ItemSizeTest"]) {
    return [ItemSizeTest fileItemTestFromDictionary: dict];
  }
  else if ([classString isEqualToString: @"CompoundAndItemTest"]) {
    return [CompoundAndItemTest fileItemTestFromDictionary: dict];
  }
  else if ([classString isEqualToString: @"CompoundOrItemTest"]) {
    return [CompoundOrItemTest fileItemTestFromDictionary: dict];
  }
  else if ([classString isEqualToString: @"NotItemTest"]) {
    return [NotItemTest fileItemTestFromDictionary: dict];
  } 
  else if ([classString isEqualToString: @"ItemNameTest"]) {
    return [ItemNameTest fileItemTestFromDictionary: dict];
  }
  else if ([classString isEqualToString: @"ItemPathTest"]) {
    return [ItemPathTest fileItemTestFromDictionary: dict];
  }
  else if ([classString isEqualToString: @"ItemTypeTest"]) {
    return [ItemTypeTest fileItemTestFromDictionary: dict];
  }
  else if ([classString isEqualToString: @"ItemFlagsTest"]) {
    return [ItemFlagsTest fileItemTestFromDictionary: dict];
  }
  else if ([classString isEqualToString: @"SelectiveItemTest"]) {
    return [SelectiveItemTest fileItemTestFromDictionary: dict];
  }
  
  NSLog(@"Unrecognized file item test class \"%@\".", classString);
  return nil;
}

// Implements (one of the) designated initialisers
- (instancetype) init {
  return [super init];
}

/* Initialiser used when the test is restored from a dictionary.
 */
- (instancetype) initWithPropertiesFromDictionary:(NSDictionary *)dict {
  return [super init];
}


- (NSDictionary *)dictionaryForObject {
  NSMutableDictionary  *dict = [NSMutableDictionary dictionaryWithCapacity: 8];
  
  [self addPropertiesToDictionary: dict];
  
  return dict;
}

@end // @implementation FileItemTest


@implementation FileItemTest (ProtectedMethods)

- (void) addPropertiesToDictionary:(NSMutableDictionary *)dict {
  // void
}

@end // @implementation FileItemTest (ProtectedMethods)
