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

#import "UniformType.h"

@implementation UniformType

- (instancetype) initWithUniformTypeIdentifier:(NSString *)utiVal
                                   description:(NSString *)descriptionVal
                                       parents:(NSArray *)parentTypes {

  if (self = [super init]) { 
    uti = [utiVal retain];
    description = [descriptionVal retain];
    
    parents = [[NSSet setWithArray: parentTypes] retain];
  }
  
  return self;
  
}

- (void) dealloc {
  [uti release];
  [description release];
  [parents release];
  
  [super dealloc];
}


- (NSString *)uniformTypeIdentifier {
  return uti;
}

- (NSString *)description {
  return description;
}

- (NSSet *)parentTypes {
  return parents;
}


- (NSSet *)ancestorTypes {
  NSMutableSet  *ancestors = [NSMutableSet setWithCapacity: 16];

  NSMutableArray  *toVisit = [NSMutableArray arrayWithCapacity: 8];
  [toVisit addObject: self];
  
  while (toVisit.count > 0) {
    // Visit next node in the list.
    UniformType  *current = toVisit.lastObject;
    [toVisit removeLastObject];
  
    // Add parents that have not yet been encountered to list of nodes to visit.
    for (UniformType *parentType in [current.parentTypes objectEnumerator]) {
      if (! [ancestors containsObject: parentType]) {
        // Only visit ancestor types that have not yet been encountered. This ensures that the
        // search time is linear in the number of ancestors (despite there possibly being multiple
        // paths to certain ancestors).
        [ancestors addObject: parentType];
        [toVisit addObject: parentType];
      }
    }
  }

  return ancestors;
}

@end
