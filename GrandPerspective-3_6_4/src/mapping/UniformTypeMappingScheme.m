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

#import "UniformTypeMappingScheme.h"

#import "FileItemMapping.h"
#import "PlainFileItem.h"
#import "UniformType.h"
#import "UniformTypeRanking.h"


@interface UniformTypeMappingScheme (PrivateMethods)

- (void) typeRankingChanged:(NSNotification *)notification;

@end


@interface MappingByUniformType : FileItemMapping {

  // Cache mapping UTIs (NSString) to integer values (NSNumber)
  NSMutableDictionary  *hashForUTICache;
  
  NSArray  *orderedTypes;
}

- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithUniformTypeRanking:(UniformTypeRanking *)typeRanking
  NS_DESIGNATED_INITIALIZER;

@end


@implementation UniformTypeMappingScheme

- (instancetype) init {
  return [self initWithUniformTypeRanking: UniformTypeRanking.defaultUniformTypeRanking];

}

- (instancetype) initWithUniformTypeRanking: (UniformTypeRanking *)typeRanking {
  if (self = [super init]) {
    _uniformTypeRanking = [typeRanking retain];
    
    NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;

    [nc addObserver: self
           selector: @selector(typeRankingChanged:)
               name: UniformTypeRankingChangedEvent
             object: typeRanking];
  }
  
  return self;
}

- (void) dealloc {
  [NSNotificationCenter.defaultCenter removeObserver: self];
  
  [_uniformTypeRanking release];
  
  [super dealloc];
}


//----------------------------------------------------------------------------
// Implementation of FileItemMappingScheme protocol

- (FileItemMapping *)fileItemMappingForTree:(DirectoryItem *)tree {
  return [[[MappingByUniformType alloc] initWithUniformTypeRanking: _uniformTypeRanking]
          autorelease];
}

@end // @implementation UniformTypeMappingScheme


@implementation UniformTypeMappingScheme (PrivateMethods)

- (void) typeRankingChanged: (NSNotification *)notification {
  NSNotificationCenter  *nc = NSNotificationCenter.defaultCenter;
  
  [nc postNotificationName: MappingSchemeChangedEvent object: self];
}

@end // @implementation UniformTypeMappingScheme (PrivateMethods)


@implementation MappingByUniformType

- (instancetype) initWithUniformTypeRanking:(UniformTypeRanking *)typeRanking {

  if (self = [super init]) {
    hashForUTICache = [[NSMutableDictionary dictionaryWithCapacity: 16] retain];
    orderedTypes = [typeRanking.undominatedRankedUniformTypes retain];
  }
  
  return self;
}

- (void) dealloc {
  [hashForUTICache release];
  [orderedTypes release];
  
  [super dealloc];
}


//----------------------------------------------------------------------------
// Implementation of FileItemMapping protocol

- (NSUInteger) hashForFileItem:(FileItem *)item atDepth:(NSUInteger)depth {
  UniformType  *type = item.isDirectory ? nil : ((PlainFileItem *)item).uniformType;
  
  if (type == nil) {
    // Unknown type
    return NSIntegerMax;
  }
  
  NSString  *uti = type.uniformTypeIdentifier;
  NSNumber  *hash = hashForUTICache[uti];
  if (hash != nil) {
    return hash.intValue;
  }
    
  NSSet  *ancestorTypes = type.ancestorTypes;
  NSUInteger  utiIndex = 0;
  
  while (utiIndex < orderedTypes.count) {
    UniformType  *orderedType = orderedTypes[utiIndex];
  
    if (type == orderedType || [ancestorTypes containsObject: orderedType]) {
      // Found the first type in the list that the file item conforms to.
      
      // Add it to the cache for next time.
      hashForUTICache[uti] = @(utiIndex);
      return utiIndex;
    }
    
    utiIndex++;
  }
  
  NSAssert(NO, @"No conforming type found.");
  return 0;
}

- (NSUInteger) colorIndexForHash:(NSUInteger)hash numColors:(NSUInteger)numColors {
  return MIN(hash, numColors - 1);
}

- (BOOL)providesLegend {
  return YES;
}

- (NSString *)legendForColorIndex:(NSUInteger)colorIndex numColors:(NSUInteger)numColors {
  if (colorIndex >= orderedTypes.count) {
    return nil;
  }

  if (colorIndex == numColors - 1) {
    return NSLocalizedString(@"other file types",
                             @"Misc. description for File type mapping scheme.");
  }
  
  UniformType  *type = orderedTypes[colorIndex];
  
  NSString  *descr = type.description;
   
  return (descr != nil) ? descr : type.uniformTypeIdentifier;
}

@end
