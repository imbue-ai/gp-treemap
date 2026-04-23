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

#import "FilterTestRef.h"


@implementation FilterTestRef

+ (id) filterTestWithName:(NSString *)name {
  return [[[FilterTestRef alloc] initWithName: name] autorelease];
}

+ (id) filterTestWithName:(NSString *)name inverted:(BOOL) inverted {
  return [[[FilterTestRef alloc] initWithName: name inverted: inverted] autorelease];
}


+ (FilterTestRef *)filterTestRefFromDictionary:(NSDictionary *)dict {
  return 
    [FilterTestRef filterTestWithName: dict[@"name"]
                             inverted: [dict[@"inverted"] boolValue]];
}


- (instancetype) initWithName:(NSString *)nameVal {
  return [self initWithName: nameVal inverted: NO];
}

- (instancetype) initWithName:(NSString *)name inverted:(BOOL)inverted {
  if (self = [super init]) {
    _name = [[NSString alloc] initWithString: name]; // Ensure it's immutable
    _inverted = inverted;
  }

  return self;
}

- (void) dealloc {
  [_name release];
  
  [super dealloc];
}


- (NSDictionary *)dictionaryForObject {
  return @{@"inverted": @(self.isInverted), @"name": self.name};
}

@end // @implementation FilterTestRef
