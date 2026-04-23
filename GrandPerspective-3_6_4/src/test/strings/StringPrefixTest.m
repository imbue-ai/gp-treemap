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

#import "StringPrefixTest.h"


@implementation StringPrefixTest

- (void) addPropertiesToDictionary:(NSMutableDictionary *)dict {
  [super addPropertiesToDictionary: dict];
  
  dict[@"class"] = @"StringPrefixTest";
}


- (BOOL) testString:(NSString *)string matches:(NSString *)matchTarget {
  NSUInteger  stringLen = string.length;
  NSUInteger  matchTargetLen = matchTarget.length;
  
  if (stringLen < matchTargetLen) {
    return NO;
  }
  else {
    return [string compare: matchTarget
                   options: self.isCaseSensitive ? 0 : NSCaseInsensitiveSearch
                     range: NSMakeRange( 0, matchTargetLen)
            ] == NSOrderedSame;
  }
}

- (NSString *)descriptionFormat {
  return self.isCaseSensitive
    ? NSLocalizedStringFromTable(@"%@ starTs with %@", @"Tests",
                                 @"Case-sensitive string test with 1: subject, and 2: match targets")
    : NSLocalizedStringFromTable(@"%@ starts with %@", @"Tests",
                                 @"String test with 1: subject, and 2: match targets");
}


+ (StringTest *)stringTestFromDictionary:(NSDictionary *)dict {
  NSAssert([dict[@"class"] isEqualToString: @"StringPrefixTest"],
           @"Incorrect value for class in dictionary.");

  return [[[StringPrefixTest alloc] initWithPropertiesFromDictionary: dict] autorelease];
}

@end
