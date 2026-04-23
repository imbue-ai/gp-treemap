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

#import "ItemTypeTest.h"

#import "TestDescriptions.h"
#import "PlainFileItem.h"
#import "FileItemTestVisitor.h"
#import "UniformType.h"
#import "UniformTypeInventory.h"


@interface ItemTypeTest (PrivateMethods)

/* Note, this property constructs a new array on each invocation.
 */
@property (nonatomic, readonly, copy) NSArray *matchTargetsAsStrings;

@end


@implementation ItemTypeTest

- (instancetype) initWithMatchTargets:(NSArray *)matchTargets {
  return [self initWithMatchTargets: matchTargets strict: NO];
}

- (instancetype) initWithMatchTargets:(NSArray *)matchTargets strict:(BOOL)strict {
  if (self = [super init]) {
    // Make the array immutable
    _matchTargets = [[NSArray alloc] initWithArray: matchTargets];

    _strict = strict;
  }
  
  return self;
}

- (instancetype) initWithPropertiesFromDictionary:(NSDictionary *)dict {
  if (self = [super initWithPropertiesFromDictionary: dict]) {
    NSArray  *utis = dict[@"matches"];
    NSUInteger  numMatchTargets = utis.count;

    UniformTypeInventory  *typeInventory = UniformTypeInventory.defaultUniformTypeInventory;

    NSMutableArray  *tmpMatches = [NSMutableArray arrayWithCapacity: numMatchTargets];
    
    NSUInteger  i = 0;
    while (i < numMatchTargets) {
      UniformType  *type = [typeInventory uniformTypeForIdentifier: utis[i]];
        
      if (type != nil) {
        [tmpMatches addObject: type];
      }
      
      i++;
    }
    
    // Make the array immutable
    _matchTargets = [[NSArray alloc] initWithArray: tmpMatches];
    
    _strict = [dict[@"strict"] boolValue];
  }
  
  return self;
}

- (void) dealloc {
  [_matchTargets release];

  [super dealloc];
}


- (void) addPropertiesToDictionary:(NSMutableDictionary *)dict {
  [super addPropertiesToDictionary: dict];
  
  dict[@"class"] = @"ItemTypeTest";
  dict[@"matches"] = self.matchTargetsAsStrings;
  dict[@"strict"] = @(self.strict);
}


- (TestResult) testFileItem:(FileItem *)item context:(id) context {
  if (item.isDirectory) {
    // Test does not apply to directories
    return TestNotApplicable;
  }
  
  UniformType  *type = ((PlainFileItem *)item).uniformType;
  NSSet  *ancestorTypes = self.isStrict ? nil : type.ancestorTypes;
    
  NSUInteger  i = self.matchTargets.count;
  while (i-- > 0) {
    UniformType  *matchType = self.matchTargets[i];
    if (type == matchType || [ancestorTypes containsObject: matchType]) {
      return TestPassed;
    }
  }
  
  return TestFailed;
}

- (BOOL) appliesToDirectories {
  return NO;
}

- (void) acceptFileItemTestVisitor:(NSObject <FileItemTestVisitor> *)visitor {
  [visitor visitItemTypeTest: self];
}


- (NSString *)description {
  NSString  *matchTargetsDescr = descriptionForMatchTargets(self.matchTargetsAsStrings);
  NSString  *format = (self.isStrict
                       ? NSLocalizedStringFromTable(
                           @"type equals %@", @"Tests",
                           @"Filetype test with 1: match targets")
                       : NSLocalizedStringFromTable(
                           @"type conforms to %@", @"Tests",
                           @"Filetype test with 1: match targets"));
  
  return [NSString stringWithFormat: format, matchTargetsDescr];
}


+ (FileItemTest *)fileItemTestFromDictionary:(NSDictionary *)dict { 
  NSAssert([dict[@"class"] isEqualToString: @"ItemTypeTest"],
           @"Incorrect value for class in dictionary.");

  return [[[ItemTypeTest alloc] initWithPropertiesFromDictionary: dict] autorelease];
}

@end


@implementation ItemTypeTest (PrivateMethods)

- (NSArray *)matchTargetsAsStrings {
  NSUInteger  numMatchTargets = self.matchTargets.count;
  NSMutableArray  *utis = [NSMutableArray arrayWithCapacity: numMatchTargets];

  NSUInteger  i = 0;
  while (i < numMatchTargets) {
    [utis addObject: ((UniformType *)self.matchTargets[i]).uniformTypeIdentifier];
    i++;
  }
  
  return utis;
}

@end // @implementation ItemTypeTest (PrivateMethods)
