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

#import "CompoundOrItemTest.h"

#import "FileItemTestVisitor.h"


@implementation CompoundOrItemTest

- (void) addPropertiesToDictionary:(NSMutableDictionary *)dict {
  [super addPropertiesToDictionary: dict];
  
  dict[@"class"] = @"CompoundOrItemTest";
}


- (TestResult) testFileItem:(FileItem *)item context:(id) context {
  NSUInteger  max = self.subItemTests.count;
  NSUInteger  i = 0;
  BOOL  applicable = NO;
  
  while (i < max) {
    TestResult  result = [self.subItemTests[i++] testFileItem: item context: context];
      
    if (result == TestPassed) {
      // Short-circuit evaluation.
      return TestPassed;
    }
    if (result == TestFailed) {
      // Test cannot return "TestNotApplicable" anymore
      applicable = YES;
    }
  }

  return applicable ? TestFailed : TestNotApplicable;
}

- (void) acceptFileItemTestVisitor:(NSObject <FileItemTestVisitor> *)visitor {
  [visitor visitCompoundOrItemTest: self];
}


- (NSString *)bootstrapDescriptionTemplate {
  return NSLocalizedStringFromTable(@"(%@) or (%@)" , @"Tests",
                                    @"OR-test with 1: sub test, and 2: another sub test");
}

- (NSString *)repeatingDescriptionTemplate {
  return NSLocalizedStringFromTable(@"(%@) or %@" , @"Tests",
                                    @"OR-test with 1: sub test, and 2: two or more other sub tests");
}


+ (FileItemTest *)fileItemTestFromDictionary:(NSDictionary *)dict {
  NSAssert([dict[@"class"] isEqualToString: @"CompoundOrItemTest"],
           @"Incorrect value for class in dictionary.");

  return [[[CompoundOrItemTest alloc] initWithPropertiesFromDictionary: dict] autorelease];
}

@end
