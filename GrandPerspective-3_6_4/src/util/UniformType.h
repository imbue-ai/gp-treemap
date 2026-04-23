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


// Note: Instances are immutable (and as a result, the class is thread-safe). 
@interface UniformType : NSObject {
  NSString  *uti;
  NSString  *description;

  // An immutable set of "UniformType"s
  NSSet  *parents;
}

// Overrides super's designated initialiser.
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithUniformTypeIdentifier:(NSString *)uti
                                   description:(NSString *)description
                                       parents:(NSArray *)parentTypes NS_DESIGNATED_INITIALIZER;

@property (nonatomic, readonly, copy) NSString *uniformTypeIdentifier;

@property (nonatomic, readonly, copy) NSString *description;

@property (nonatomic, readonly, copy) NSSet *parentTypes;

/* Dynamically constructs the set of types that the receiving type conforms to (directly or
 * indirectly).
 *
 * Conformance of a given type, typeA, to another type, typeB can be tested as follows:
 *
 *   (typeA == typeB) || ([typeA.ancestorTypes containsObject: typeB])
 *
 * The reason that there is no method implementing this test directly is that for multiple
 * subsequent conformance tests for the same type, which is typical usage, you should construct the
 * ancestor set only once. This could easily be forgotten if there would be a -conformsTo:
 * convenience method. Furthermore, such a method would also hide the execution overhead associated
 * with conformance tests.
 */
@property (nonatomic, readonly, copy) NSSet *ancestorTypes;

@end
