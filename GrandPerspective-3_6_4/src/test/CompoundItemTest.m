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

#import "CompoundItemTest.h"

#import "LocalizableStrings.h"


@interface CompoundItemTest (PrivateMethods) 

/* Not implemented. Needs to be provided by subclass.
 *
 * It should return a template for describing a test consisting of two sub-tests. The string should
 * have two "%@" arguments. The first for the description of the first sub-test, and the second for
 * the second sub-test.
 */
@property (nonatomic, readonly, copy) NSString *bootstrapDescriptionTemplate;

/* Not implemented. Needs to be provided by subclass.
 *
 * It should return a template for describing a test consisting of three or more sub-tests. The
 * string should have two "%@" arguments. The first for the description of the first sub-test, and
 * the second for the description of the remaining sub-tests. The template will be applied
 * iteratively.
 */
@property (nonatomic, readonly, copy) NSString *repeatingDescriptionTemplate;

@end // CompoundItemTest (PrivateMethods) 


@implementation CompoundItemTest

- (instancetype) initWithSubItemTests:(NSArray*)subItemTests {
  if (self = [super init]) {
    NSAssert([subItemTests count] >= 2, @"Compound test should have two or more sub-tests");
  
    // Make the array immutable
    _subItemTests = [[NSArray alloc] initWithArray: subItemTests];
  }
  
  return self;
}

- (instancetype) initWithPropertiesFromDictionary:(NSDictionary *)dict {
  if (self = [super initWithPropertiesFromDictionary: dict]) {
    NSArray  *subTestDicts = dict[@"subTests"];
    NSMutableArray  *tmpSubTests = [NSMutableArray arrayWithCapacity: subTestDicts.count];

    for (NSDictionary *subTestDict in [subTestDicts objectEnumerator]) {
      [tmpSubTests addObject: [FileItemTest fileItemTestFromDictionary: subTestDict]];
    }
    
    // Make the array immutable
    _subItemTests = [[NSArray alloc] initWithArray: tmpSubTests];
  }
  
  return self;
}

- (void) dealloc {
  [_subItemTests release];

  [super dealloc];
}


- (void) addPropertiesToDictionary:(NSMutableDictionary *)dict {
  [super addPropertiesToDictionary: dict];
  
  NSMutableArray  *subTestsDicts = [NSMutableArray arrayWithCapacity: self.subItemTests.count];
  for (FileItemTest *subTest in [self.subItemTests objectEnumerator]) {
    [subTestsDicts addObject: [subTest dictionaryForObject]];
  }

  dict[@"subTests"] = subTestsDicts;
}


- (TestResult) testFileItem:(FileItem *)item {
  NSAssert(NO, @"This method must be overridden.");
  return TestFailed;
}

- (BOOL) appliesToDirectories {
  NSUInteger  max = self.subItemTests.count;
  NSUInteger  i = 0;
  
  while (i < max) {
    if ([self.subItemTests[i++] appliesToDirectories]) {
      return YES;
    }
  }
  return NO;
}


- (NSString *)description {
  return [LocalizableStrings localizedEnumerationString: self.subItemTests
                                           pairTemplate: [self bootstrapDescriptionTemplate]
                                      bootstrapTemplate: [self bootstrapDescriptionTemplate]
                                      repeatingTemplate: [self repeatingDescriptionTemplate]];
}

@end
