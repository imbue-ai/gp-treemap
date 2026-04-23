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

#import "NamedFilter.h"

#import "Filter.h"


@implementation NamedFilter

+ (NamedFilter *)emptyFilterWithName:(NSString *)name {
  return [[[NamedFilter alloc] initWithFilter: [Filter filter] name: name] autorelease];
}

+ (NamedFilter *)namedFilter:(Filter *)filter name:(NSString *)name {
  return [[[NamedFilter alloc] initWithFilter: filter name: name] autorelease];
}


- (instancetype) initWithFilter:(Filter *)filter name:(NSString *)name {
  return [self initWithFilter: filter name: name implicit: NO];
}

- (instancetype) initWithFilter:(Filter *)filter name:(NSString *)name implicit:(BOOL)implicit {
  if (self = [super init]) {
    _filter = [filter retain];
    _name = [name retain];
    _isImplicit = implicit;
  }
  return self;
}

- (void) dealloc {
  [_filter release];
  [_name release];
  
  [super dealloc];
}

- (NSString *)localizedName {
  return [NSBundle.mainBundle localizedStringForKey: self.name value: nil table: @"Names"];
}

@end
