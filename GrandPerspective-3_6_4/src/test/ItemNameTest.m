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

#import "ItemNameTest.h"

#import "FileItem.h"
#import "StringTest.h"
#import "FileItemTestVisitor.h"


@implementation ItemNameTest 

- (void) addPropertiesToDictionary:(NSMutableDictionary *)dict {
  [super addPropertiesToDictionary: dict];
  
  dict[@"class"] = @"ItemNameTest";
}


- (TestResult) testFileItem:(FileItem *)item context:(id) context {
  return [self.stringTest testString: [item pathComponent]] ? TestPassed : TestFailed;
}

- (BOOL) appliesToDirectories {
  return YES;
}

- (void) acceptFileItemTestVisitor:(NSObject <FileItemTestVisitor> *)visitor {
  [visitor visitItemNameTest: self];
}


- (NSString *)description {
  NSString  *subject = 
    NSLocalizedStringFromTable(@"name" , @"Tests",
                               @"A filename as the subject of a string test");

  return [self.stringTest descriptionWithSubject: subject];
}


+ (FileItemTest *)fileItemTestFromDictionary:(NSDictionary *)dict {
  NSAssert([dict[@"class"] isEqualToString: @"ItemNameTest"],
           @"Incorrect value for class in dictionary.");

  return [[[ItemNameTest alloc] initWithPropertiesFromDictionary: dict] autorelease];
}

@end
