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

#import "FileItemMapping.h"

@implementation FileItemMapping

- (NSUInteger) hashForFileItem:(FileItem *)item atDepth:(NSUInteger)depth {
  return 0;
}

- (NSUInteger) hashForFileItem:(FileItem *)item inTree:(FileItem *)treeRoot {
  // By default assuming that "depth" is not used in the hash calculation. If it is, this method
  // needs to be overridden.
  return [self hashForFileItem: item atDepth: 0];
}

- (NSUInteger) colorIndexForHash:(NSUInteger)hash numColors:(NSUInteger)numColors {
  // By default use modulus. More complex mappings can override this method so that all colors
  // except one (typically the last but not necessarily) represent only a single hash.
  return hash % numColors;
}

- (BOOL)providesLegend {
  return NO;
}

- (NSString *)legendForColorIndex:(NSUInteger)colorIndex numColors:(NSUInteger)numColors {
  // By default, no description
  return nil;
}

@end
