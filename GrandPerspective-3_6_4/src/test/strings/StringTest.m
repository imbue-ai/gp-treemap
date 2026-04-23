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

#import "StringTest.h"

#import "StringPrefixTest.h"
#import "StringSuffixTest.h"
#import "StringEqualityTest.h"
#import "StringContainmentTest.h"


@implementation StringTest

+ (StringTest *)stringTestFromDictionary:(NSDictionary *)dict {
  NSString  *classString = dict[@"class"];
  
  if ([classString isEqualToString: @"StringContainmentTest"]) {
    return [StringContainmentTest stringTestFromDictionary: dict];
  }
  else if ([classString isEqualToString: @"StringSuffixTest"]) {
    return [StringSuffixTest stringTestFromDictionary: dict];
  }
  else if ([classString isEqualToString: @"StringPrefixTest"]) {
    return [StringPrefixTest stringTestFromDictionary: dict];
  }
  else if ([classString isEqualToString: @"StringEqualityTest"]) {
    return [StringEqualityTest stringTestFromDictionary: dict];
  }

  NSAssert1(NO, @"Unrecognized string test class \"%@\".", classString);
  return nil;
}

- (instancetype) init {
  return [super init];
}
- (instancetype) initWithPropertiesFromDictionary:(NSDictionary *)dict {
  return [super init];
}

@end


@implementation StringTest (ProtectedMethods)

- (void) addPropertiesToDictionary:(NSMutableDictionary *)dict {
  // void
}

@end
