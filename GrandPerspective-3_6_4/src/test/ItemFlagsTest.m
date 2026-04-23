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

#import "ItemFlagsTest.h"

#import "FileItem.h"
#import "FileItemTestVisitor.h"


@implementation ItemFlagsTest

- (instancetype) initWithFlagsMask:(FileItemOptions)mask desiredResult:(FileItemOptions)result {
  if (self = [super init]) {
    _flagsMask = mask;
    _desiredResult = result;
  }
  
  return self;

}

- (instancetype) initWithPropertiesFromDictionary:(NSDictionary *)dict {
  if (self = [super initWithPropertiesFromDictionary: dict]) {
    id  object;
    
    object = dict[@"flagsMask"];
    _flagsMask = (object == nil) ? 0 : [object unsignedCharValue];
     
    object = dict[@"desiredResult"];
    _desiredResult = (object == nil) ? 0 : [object unsignedCharValue];
  }
  
  return self;
}


- (void) addPropertiesToDictionary:(NSMutableDictionary *)dict {
  [super addPropertiesToDictionary: dict];
  
  dict[@"class"] = @"ItemFlagsTest";
  
  dict[@"flagsMask"] = @(self.flagsMask);
  dict[@"desiredResult"] = @(self.desiredResult);
}


- (TestResult) testFileItem:(FileItem *)item context:(id)context {
  return ([item fileItemFlags] & self.flagsMask) == self.desiredResult ? TestPassed : TestFailed;
}

- (BOOL) appliesToDirectories {
  return YES;
}

- (void) acceptFileItemTestVisitor:(NSObject <FileItemTestVisitor> *)visitor {
  [visitor visitItemFlagsTest: self];
}


- (NSString *)description {
  
  // The total description (so far)
  NSString  *s = nil;
  
  // Description of a single flags test.
  NSString  *sub;
  
  NSString  *andFormat = NSLocalizedStringFromTable
    (@"%@ and %@", @"Tests",
     @"AND-test for flags sub tests with 1: subtest, 2: one or more sub tests");
  
  if (self.flagsMask & FileItemIsHardlinked) {
    if (self.desiredResult & FileItemIsHardlinked) {
      sub = NSLocalizedStringFromTable(@"item is hard-linked", @"Tests",
                                       @"File/folder flags sub test");
    }
    else {
      sub = NSLocalizedStringFromTable(@"item is not hard-linked", @"Tests",
                                       @"File/folder flags sub test");
    }
    s = sub;
  }
  
  if (self.flagsMask & FileItemIsPackage) {
    if (self.desiredResult & FileItemIsPackage) {
      sub = NSLocalizedStringFromTable(@"item is a package", @"Tests",
                                       @"File/folder flags sub test");
    }
    else {
      sub = NSLocalizedStringFromTable(@"item is not a package", @"Tests",
                                       @"File/folder flags sub test");
      }

    if ( s == nil ) {
      s = sub;
    }
    else {
      s = [NSString stringWithFormat: andFormat, s, sub];
    }
  }
  
  return s;
}


+ (FileItemTest *)fileItemTestFromDictionary:(NSDictionary *)dict {
  NSAssert([dict[@"class"] isEqualToString: @"ItemFlagsTest"],
           @"Incorrect value for class in dictionary.");

  return [[[ItemFlagsTest alloc] initWithPropertiesFromDictionary: dict] autorelease];
}

@end
