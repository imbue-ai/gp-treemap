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

@class FileItem;
@class PlainFileItem;

/* An implementation of a particular file item mapping scheme. It can map file items to hash values.
 *
 * Implementations are not (necessarily) thread-safe. Each thread should get an instance it can
 * safely use by invoking -fileItemMapping on the file item mapping scheme.
 */
@interface FileItemMapping : NSObject {
}

/* Calculates a hash value for a file item in a tree, when the item is encountered while traversing
 * the tree. The calculation may use the "depth" of the file item relative to the root of the tree,
 * as provided by the TreeLayoutBuilder to the TreeLayoutTraverser.
 *
 * For calculating the hash value when not traversing a tree, use -hashForFileItem:inTree:.
 */
- (NSUInteger) hashForFileItem:(FileItem *)item atDepth:(NSUInteger)depth;

/* Calculates a hash value for a given file item in a tree. It performs the same calculation as
 * -hashForFileItem:depth:. Unlike the latter method, this one can be used when a tree is not being
 * traversed (and the "depth" of the item is not easily available). The depth will be calculated
 * relative to the provided tree root.
 */
- (NSUInteger) hashForFileItem:(FileItem *)item inTree:(FileItem *)treeRoot;

/* Returns the color index for the given hash, given the number of available colors.
 */
- (NSUInteger) colorIndexForHash:(NSUInteger)hash numColors:(NSUInteger)numColors;

- (BOOL)providesLegend;

/* Description for the given color index, if any. Returns nil if no suitable description can be
 * provided.
 */
- (NSString *)legendForColorIndex:(NSUInteger)colorIndex numColors:(NSUInteger)numColors;

@end
