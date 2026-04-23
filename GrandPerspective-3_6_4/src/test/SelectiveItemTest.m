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

#import "SelectiveItemTest.h"

#import "FileItemTestVisitor.h"
#import "FileItem.h"


@implementation SelectiveItemTest

- (instancetype) initWithSubItemTest:(FileItemTest *)subItemTest
                           onlyFiles:(BOOL)onlyFiles {
  if (self = [super init]) {
    _subItemTest = [subItemTest retain];

    _applyToFilesOnly = onlyFiles;
  }
  
  return self;
}

- (instancetype) initWithPropertiesFromDictionary:(NSDictionary *)dict {
  if (self = [super initWithPropertiesFromDictionary: dict]) {
    NSDictionary  *subTestDict = dict[@"subTest"];
    
    _subItemTest = [[FileItemTest fileItemTestFromDictionary: subTestDict] retain];
    _applyToFilesOnly = [dict[@"onlyFiles"] boolValue];
  }
  
  return self;
}

- (void) dealloc {
  [_subItemTest release];

  [super dealloc];
}


- (void) addPropertiesToDictionary:(NSMutableDictionary *)dict {
  [super addPropertiesToDictionary: dict];
  
  dict[@"class"] = @"SelectiveItemTest";
  dict[@"subTest"] = [self.subItemTest dictionaryForObject];
  dict[@"onlyFiles"] = @(self.applyToFilesOnly);
}


- (TestResult) testFileItem:(FileItem *)item context:(id) context {
  if (item.isDirectory == self.applyToFilesOnly) {
    // Test should not be applied to this type of item.
    return TestNotApplicable;
  }
  
  return [self.subItemTest testFileItem: item context: context] ? TestPassed : TestFailed;
}

- (BOOL) appliesToDirectories {
  return !self.applyToFilesOnly;
}


- (void) acceptFileItemTestVisitor:(NSObject <FileItemTestVisitor> *)visitor {
  [visitor visitSelectiveItemTest: self];
}


- (NSString *)description {
  NSString  *format = (self.applyToFilesOnly
                       ? NSLocalizedStringFromTable(@"files: %@", @"Tests",
                                                    @"Selective test with 1: sub test")
                       : NSLocalizedStringFromTable(@"folders: %@", @"Tests",
                                                    @"Selective test with 1: sub test"));
  
  return [NSString stringWithFormat: format, self.subItemTest.description];
}


+ (FileItemTest *)fileItemTestFromDictionary:(NSDictionary *)dict { 
  NSAssert([dict[@"class"] isEqualToString: @"SelectiveItemTest"],
           @"Incorrect value for class in dictionary.");

  return [[[SelectiveItemTest alloc] initWithPropertiesFromDictionary: dict] autorelease];
}

@end

