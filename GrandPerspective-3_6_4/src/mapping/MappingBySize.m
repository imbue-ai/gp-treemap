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

#import "MappingBySize.h"

#import "CompoundItem.h"
#import "DirectoryItem.h"
#import "PlainFileItem.h"
#import "FileItemMapping.h"


/* Mapping scheme that maps each file item to a hash based on a time that is associated with the
 * file item.
 */
@interface SizeBasedMapping : FileItemMapping {
  // The lower size bound for the category containing the largest file items
  item_size_t maxItemSizeLimit;
}

- (instancetype) init NS_UNAVAILABLE;
- (instancetype) initWithTree:(DirectoryItem *)tree NS_DESIGNATED_INITIALIZER;

@end // @interface SizeBasedMapping


@interface SizeBasedMapping (PrivateMethods)

- (void) initSizeBounds:(DirectoryItem *)treeRoot;
- (void) visitItemToDetermineSizeBounds:(Item *)item;

@end // @interface SizeBasedMapping (PrivateMethods)


@implementation SizeBasedMapping

// All items below this size map to the same hash
const item_size_t  minUpperBound = 1024;

- (instancetype) initWithTree:(DirectoryItem *)tree {
  if (self = [super init]) {
    [self initSizeBounds: tree];
  }
  return self;
}


- (NSUInteger) hashForFileItem:(FileItem *)item atDepth:(NSUInteger)depth {
  item_size_t  itemSize = item.itemSize;
  item_size_t  limit = maxItemSizeLimit;
  NSUInteger  hash = 0;

  while (limit > minUpperBound) {
    if (itemSize > limit) {
      return hash;
    }
    hash++;
    limit /= 2;
  }

  return hash;
}

- (NSUInteger) colorIndexForHash:(NSUInteger)hash numColors:(NSUInteger)numColors {
  NSUInteger maxIndex = numColors - 1;

  return maxIndex - MIN(hash, maxIndex);
}

- (BOOL)providesLegend {
  return YES;
}

- (NSString *)legendForColorIndex:(NSUInteger)colorIndex numColors:(NSUInteger)numColors {
  NSUInteger maxIndex = numColors - 1;
  NSUInteger hash = maxIndex - colorIndex;

  if (hash == 0) {
    NSString *fmt = NSLocalizedString(@"Larger than %@",
                                      @"Legend for Size-based mapping scheme.");
    return [NSString stringWithFormat: fmt, [FileItem stringForFileItemSize: maxItemSizeLimit]];
  }

  item_size_t  lowerBound = maxItemSizeLimit;
  item_size_t  upperBound = 0;

  NSUInteger  i = hash;
  while (i > 0 && lowerBound >= minUpperBound) {
    upperBound = lowerBound;
    lowerBound /= 2;
    i--;
  }

  if (upperBound > minUpperBound) {
    if (colorIndex > 0) {
      NSString *fmt = NSLocalizedString(@"%@ - %@",
                                        @"Legend for Size-based mapping scheme.");
      return [NSString stringWithFormat: fmt,
              [FileItem stringForFileItemSize: lowerBound],
              [FileItem stringForFileItemSize: upperBound]];
    } else {
      return NSLocalizedString(@"Smallest",
                               @"Legend for Size-based mapping scheme.");
    }
  } else if (i == 0) {
    NSString *fmt = NSLocalizedString(@"Smaller than %@",
                                      @"Legend for Size-based mapping scheme.");
    return [NSString stringWithFormat: fmt,
            [FileItem stringForFileItemSize: upperBound]];
  } else {
    return nil;
  }
}

@end // @implementation TimeBasedMapping


@implementation SizeBasedMapping (PrivateMethods)

- (void) initSizeBounds:(DirectoryItem *)treeRoot {
  maxItemSizeLimit = 0;

  [self visitItemToDetermineSizeBounds: treeRoot];

  NSLog(@"maxSize (before) = %lld", maxItemSizeLimit);

  // Round down towards clean boundary value
  item_size_t cleanLimit = minUpperBound;
  while (cleanLimit < maxItemSizeLimit) {
    cleanLimit *= 2;
  }

  maxItemSizeLimit = cleanLimit / 2;

  NSLog(@"maxSize (after) = %lld", maxItemSizeLimit);
}


- (void) visitItemToDetermineSizeBounds:(Item *)item {
  if (item.isVirtual) {
    [self visitItemToDetermineSizeBounds: ((CompoundItem *)item).first];
    [self visitItemToDetermineSizeBounds: ((CompoundItem *)item).second];
  }
  else {
    FileItem  *fileItem = (FileItem *)item;

    if (fileItem.isDirectory) {
      if (fileItem.itemSize > maxItemSizeLimit) {
        [self visitItemToDetermineSizeBounds: ((DirectoryItem *)fileItem).fileItems];
        [self visitItemToDetermineSizeBounds: ((DirectoryItem *)fileItem).directoryItems];
      }
    } else if (fileItem.isPhysical) {
      maxItemSizeLimit = MAX(maxItemSizeLimit, fileItem.itemSize);
    }
  }
}

@end // @implementation SizeBasedMapping (PrivateMethods)


@implementation MappingBySize

//----------------------------------------------------------------------------
// Implementation of FileItemMappingScheme protocol

- (FileItemMapping *)fileItemMappingForTree:(DirectoryItem *)tree {
  return [[[SizeBasedMapping alloc] initWithTree: tree] autorelease];
}

@end // @implementation MappingBySize
