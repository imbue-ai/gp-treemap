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


/* Event that is fired by a mapping sheme to signal that there have been changes that may cause
 * one or more file items to map to a different hash value.
 */
extern NSString  *MappingSchemeChangedEvent;


@class FileItemMapping;
@class DirectoryItem;

/* A file item mapping scheme. It represents a particular algorithm for mapping file items to hash
 * values.
 *
 * File item mapping scheme can safely be used from multiple threads by multiple different views.
 */
@protocol FileItemMappingScheme

/* Returns a file item mapping instance that implements the scheme for the given tree. When the
 * implementation cannot be shared by multiple different views, a new instance is returned for each
 * invocation.
 *
 * The tree on which the mapping should operate is provided for mappings that depend on the tree
 * (e.g. to optimize the mapping)
 */
- (FileItemMapping *)fileItemMappingForTree:(DirectoryItem *)tree;

@end
