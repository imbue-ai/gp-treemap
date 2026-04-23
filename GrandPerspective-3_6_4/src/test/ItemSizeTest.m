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

#import "ItemSizeTest.h"

#import "FileItem.h"
#import "FileItemTestVisitor.h"


@implementation ItemSizeTest

- (instancetype) initWithLowerBound:(item_size_t)lowerBound {
  return [self initWithLowerBound: lowerBound upperBound: ULONG_LONG_MAX];
}

- (instancetype) initWithUpperBound:(item_size_t)upperBound {
  return [self initWithLowerBound: 0 upperBound: upperBound];
}

- (instancetype) initWithLowerBound:(item_size_t)lowerBound
                         upperBound:(item_size_t)upperBound {
  if (self = [super init]) {
    _lowerBound = lowerBound;
    _upperBound = upperBound;
  }
  
  return self;
}

- (instancetype) initWithPropertiesFromDictionary:(NSDictionary *)dict {
  if (self = [super initWithPropertiesFromDictionary: dict]) {
    id  object;
    
    object = dict[@"lowerBound"];
    _lowerBound = (object == nil) ? 0 : [object unsignedLongLongValue];
     
    object = dict[@"upperBound"];
    _upperBound = (object == nil) ? ULONG_LONG_MAX : [object unsignedLongLongValue];
  }
  
  return self;
}

- (void) addPropertiesToDictionary:(NSMutableDictionary *)dict {
  [super addPropertiesToDictionary: dict];
  
  dict[@"class"] = @"ItemSizeTest";
  
  if ([self hasLowerBound]) {
    dict[@"lowerBound"] = @(self.lowerBound);
  }
  if ([self hasUpperBound]) {
    dict[@"upperBound"] = @(self.upperBound);
  }
}


- (BOOL) hasLowerBound {
  return self.lowerBound > 0;
}

- (BOOL) hasUpperBound {
  return self.upperBound < ULONG_LONG_MAX;
}


- (TestResult) testFileItem:(FileItem *)item context:(id) context {
  return
    ([item itemSize] >= self.lowerBound &&
     [item itemSize] <= self.upperBound) ? TestPassed : TestFailed;
}

- (BOOL) appliesToDirectories {
  return YES;
}

- (void) acceptFileItemTestVisitor:(NSObject <FileItemTestVisitor> *)visitor {
  [visitor visitItemSizeTest: self];
}


- (NSString *)description {
  if ([self hasLowerBound]) {
    if ([self hasUpperBound]) {
      NSString  *fmt = 
        NSLocalizedStringFromTable(@"size is between %@ and %@", @"Tests",
                                   @"Size test with 1: lower bound, and 2: upper bound");
      return [NSString stringWithFormat: fmt, 
                [FileItem stringForFileItemSize: self.lowerBound],
                [FileItem stringForFileItemSize: self.upperBound]];
    }
    else {
      NSString  *fmt = 
        NSLocalizedStringFromTable(@"size is larger than %@", @"Tests",
                                   @"Size test with 1: lower bound");
      
      return [NSString stringWithFormat: fmt, [FileItem stringForFileItemSize: self.lowerBound]];
    }
  }
  else {
    if ([self hasUpperBound]) {
      NSString  *fmt = 
        NSLocalizedStringFromTable(@"size is smaller than %@", @"Tests",
                                   @"Size test with 1: upper bound");
      return [NSString stringWithFormat: fmt, [FileItem stringForFileItemSize: self.upperBound]];
    }
    else {
      return NSLocalizedStringFromTable(@"any size", @"Tests",
                                        @"Size test without any bounds");
    }
  }
}


+ (FileItemTest *)fileItemTestFromDictionary:(NSDictionary *)dict {
  NSAssert([dict[@"class"] isEqualToString: @"ItemSizeTest"],
           @"Incorrect value for class in dictionary.");

  return [[[ItemSizeTest alloc] initWithPropertiesFromDictionary: dict] autorelease];
}

@end // @implementation ItemSizeTest
