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

/* Protocol for validating names of filters and/or tests. It has been created so that the window for
 * editing a filter (or filter test) does not need a direct reference to the set of filters (or the
 * set of filter tests) in order to decide if the name of the filter (or filter test) does not clash
 * with that of existing filters (or filter tests).
 */
@protocol NameValidator

/* Checks if the name (of a new or modified filter or filter test) is valid (given the current set
 * of filters and tests). Returns a (localized) error message if not, and "nil" otherwise.
 */
- (NSString *)checkNameIsValid:(NSString *)name;

@end // @protocol NameValidator
