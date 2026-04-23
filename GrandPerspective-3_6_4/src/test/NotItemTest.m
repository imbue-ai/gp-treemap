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

#import "NotItemTest.h"

#import "FileItemTestVisitor.h"


@implementation NotItemTest

- (instancetype) initWithSubItemTest:(FileItemTest *)subItemTest {
  if (self = [super init]) {
    _subItemTest = [subItemTest retain];
  }

  return self;
}

- (instancetype) initWithPropertiesFromDictionary:(NSDictionary *)dict {
  if (self = [super initWithPropertiesFromDictionary: dict]) {
    NSDictionary  *subTestDict = dict[@"subTest"];
    
    _subItemTest = [[FileItemTest fileItemTestFromDictionary: subTestDict] retain];
  }
  
  return self;
}

- (void) dealloc {
  [_subItemTest release];

  [super dealloc];
}


- (void) addPropertiesToDictionary:(NSMutableDictionary *)dict {
  [super addPropertiesToDictionary: dict];
  
  dict[@"class"] = @"NotItemTest";

  dict[@"subTest"] = [self.subItemTest dictionaryForObject];
}


- (TestResult) testFileItem:(FileItem *)item context:(id) context {
  TestResult  result = [self.subItemTest testFileItem: item context: context];
  
  return (result == TestNotApplicable
          ? TestNotApplicable
          : (result == TestFailed ? TestPassed : TestFailed));
}

- (BOOL) appliesToDirectories {
  return [self.subItemTest appliesToDirectories];
}

- (void) acceptFileItemTestVisitor:(NSObject <FileItemTestVisitor> *)visitor {
  [visitor visitNotItemTest: self];
}


- (NSString *)description {
  NSString  *fmt = NSLocalizedStringFromTable(@"not (%@)" , @"Tests", @"NOT-test with 1: sub test");

  return [NSString stringWithFormat: fmt, self.subItemTest.description];
}


+ (FileItemTest *)fileItemTestFromDictionary:(NSDictionary *)dict {
  NSAssert([dict[@"class"] isEqualToString: @"NotItemTest"],
           @"Incorrect value for class in dictionary.");

  return [[[NotItemTest alloc] initWithPropertiesFromDictionary: dict] autorelease];
}

@end
