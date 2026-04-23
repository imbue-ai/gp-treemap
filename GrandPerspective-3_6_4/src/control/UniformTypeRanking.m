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

#import "UniformTypeRanking.h"

#import "UniformType.h"
#import "UniformTypeInventory.h"


NSString  *UniformTypeRankingChangedEvent = @"uniformTypeRankingChanged";

NSString  *UniformTypesRankingKey = @"uniformTypesRanking";

@interface UniformTypeRanking (PrivateMethods) 

- (void) uniformTypeAdded:(NSNotification *)notification;

@end


@implementation UniformTypeRanking

+ (UniformTypeRanking *)defaultUniformTypeRanking {
  static UniformTypeRanking  *defaultUniformTypeRankingInstance = nil;
  static dispatch_once_t  onceToken;

  dispatch_once(&onceToken, ^{
    defaultUniformTypeRankingInstance = [[UniformTypeRanking alloc] init];
  });
  
  return defaultUniformTypeRankingInstance;
}


- (instancetype) init {
  if (self = [super init]) {
    rankedTypes = [[NSMutableArray alloc] initWithCapacity: 32];
  }
  
  return self;
}

- (void) dealloc {
  [NSNotificationCenter.defaultCenter removeObserver: self];

  [rankedTypes release];
  
  [super dealloc];
}


- (void) loadRanking:(UniformTypeInventory *)typeInventory {
  NSAssert(rankedTypes.count == 0, @"List must be empty before load.");
  
  NSArray  *rankedUTIs = [NSUserDefaults.standardUserDefaults arrayForKey: UniformTypesRankingKey];

  for (NSString *uti in [rankedUTIs objectEnumerator]) {
    UniformType  *type = [typeInventory uniformTypeForIdentifier: uti];
    
    if (type != nil) {
      // Only add the type if a UniformType instance was created successfully.
      [rankedTypes addObject: type];
    }
  }
}

- (void) storeRanking {
  NSMutableArray  *rankedUTIs = [NSMutableArray arrayWithCapacity: rankedTypes.count];
  NSMutableSet  *encountered = [NSMutableSet setWithCapacity: rankedUTIs.count];

  for (UniformType *type in [rankedTypes objectEnumerator]) {
    NSString  *uti = type.uniformTypeIdentifier;
    
    if (! [encountered containsObject: uti]) {
      // Should the ranked list contain duplicate UTIs, only add the first.
      [encountered addObject: uti];
     
      [rankedUTIs addObject: uti];
    }
  }

  [NSUserDefaults.standardUserDefaults setObject: rankedUTIs forKey: UniformTypesRankingKey];
}


- (void) observeUniformTypeInventory:(UniformTypeInventory *)typeInventory {
  // Observe the inventory to for newly added types so that these can be added
  // to (the end of) the ranked list. 
  [NSNotificationCenter.defaultCenter addObserver: self
                                         selector: @selector(uniformTypeAdded:)
                                             name: UniformTypeAddedEvent
                                           object: typeInventory];
        
  // Also add any types in the inventory that are not yet in the ranking
  NSMutableSet  *typesInRanking = [NSMutableSet setWithCapacity: (rankedTypes.count + 16)];
  [typesInRanking addObjectsFromArray: rankedTypes];

  for (UniformType *type in [typeInventory uniformTypeEnumerator]) {
    if (! [typesInRanking containsObject: type]) {
      [rankedTypes addObject: type];
      [typesInRanking addObject: type]; 
    }
  }
}


- (NSArray *)rankedUniformTypes {
  // Return an immutable copy of the array.
  return [NSArray arrayWithArray: rankedTypes]; 
}

- (void) updateRankedUniformTypes:(NSArray *)ranking {
  // Updates the ranking while keeping new types that may have appeared in the meantime.
  [rankedTypes replaceObjectsInRange: NSMakeRange(0, ranking.count)
                withObjectsFromArray: ranking];
  
  // Notify any observers.
  [NSNotificationCenter.defaultCenter postNotificationName: UniformTypeRankingChangedEvent
                                                    object: self];
}


- (BOOL) isUniformTypeDominated:(UniformType *)type {
  NSUInteger  i = 0;
  NSUInteger  i_max = rankedTypes.count;
  
  NSSet  *ancestors = type.ancestorTypes;
  
  while (i < i_max) {
    UniformType  *higherType = rankedTypes[i];
    
    if (higherType == type) {
      // Found the type in the list, without encountering any type that dominates it.
      return NO;
    }

    if ([ancestors containsObject: higherType]) {
      // Found a type that dominates this one.
      return YES;
    }
    
    i++;
  }
  NSAssert(NO, @"Unexpected termination");
  return NO;
}

- (NSArray *)undominatedRankedUniformTypes {
  NSMutableArray  *undominatedTypes = [NSMutableArray arrayWithCapacity: rankedTypes.count];
    
  NSUInteger  i = 0;
  NSUInteger  i_max = rankedTypes.count;

  while (i < i_max) {
    UniformType  *type = rankedTypes[i];
    
    if (! [self isUniformTypeDominated: type]) {
      [undominatedTypes addObject: type];
    }
    
    i++;
  }
  
  return undominatedTypes;
}

@end // @implementation UniformTypeRanking


@implementation UniformTypeRanking (PrivateMethods) 

- (void) uniformTypeAdded:(NSNotification *)notification {
  UniformType  *type = notification.userInfo[UniformTypeKey];

  [rankedTypes addObject: type];
}

@end // @implementation UniformTypeRanking (PrivateMethods) 
