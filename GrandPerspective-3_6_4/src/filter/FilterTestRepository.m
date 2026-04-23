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

#import "FilterTestRepository.h"

#import "FileItemTest.h"
#import "SelectiveItemTest.h"

#import "NotifyingDictionary.h"


// The key for storing user tests
NSString  *UserTestsKey = @"filterTests";

// The key for storing application-provided tests
NSString  *AppTestsKey = @"GPDefaultFilterTests";


@interface FilterTestRepository (PrivateMethods) 

- (void) addStoredTestsFromDictionary:(NSDictionary *)testDicts
                          toLiveTests:(NSMutableDictionary *)testsByName;

@end


@implementation FilterTestRepository

+ (FilterTestRepository *)defaultFilterTestRepository {
  static FilterTestRepository  *defaultInstance = nil;
  static dispatch_once_t  onceToken;

  dispatch_once(&onceToken, ^{
    defaultInstance = [[FilterTestRepository alloc] init];
  });
  
  return defaultInstance;
}


- (instancetype) init {
  if (self = [super init]) {
    NSMutableDictionary  *initialTestDictionary = [NSMutableDictionary dictionaryWithCapacity: 16];
    
    // Load application-provided tests from the information properties file.
    NSBundle  *bundle = NSBundle.mainBundle;
      
    [self addStoredTestsFromDictionary: [bundle objectForInfoDictionaryKey: AppTestsKey]
                           toLiveTests: initialTestDictionary];
    applicationProvidedTests = [[NSDictionary alloc] initWithDictionary: initialTestDictionary];

    // Load additional user-created tests from preferences.
    NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
    [self addStoredTestsFromDictionary: [userDefaults dictionaryForKey: UserTestsKey]
                           toLiveTests: initialTestDictionary];

    // Store tests in a NotifyingDictionary
    _testsByName =
      (NSDictionary *)[[NotifyingDictionary alloc] initWithCapacity: 16
                                                    initialContents: initialTestDictionary];
  }
  
  return self;
}

- (void) dealloc {
  [_testsByName release];
  [applicationProvidedTests release];

  [super dealloc];
}


- (NotifyingDictionary *)testsByNameAsNotifyingDictionary {
  return (NotifyingDictionary *)self.testsByName;
}


- (FileItemTest *)fileItemTestForName:(NSString *)name {
  return self.testsByName[name];
}

- (FileItemTest *)applicationProvidedTestForName:(NSString *)name {
  return applicationProvidedTests[name];
}


- (void) storeUserCreatedTests {
  NSMutableDictionary  *testsDict = 
    [NSMutableDictionary dictionaryWithCapacity: self.testsByName.count];

  for (NSString *name in [self.testsByName keyEnumerator]) {
    FileItemTest  *fileItemTest = self.testsByName[name];

    if (fileItemTest != applicationProvidedTests[name]) {
      testsDict[name] = [fileItemTest dictionaryForObject];
    }
  }

  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  [userDefaults setObject: testsDict forKey: UserTestsKey];
  [userDefaults synchronize];
}

@end // @implementation FilterTestRepository


@implementation FilterTestRepository (PrivateMethods) 

- (void) addStoredTestsFromDictionary:(NSDictionary *)testDicts
                          toLiveTests:(NSMutableDictionary *)testsByNameVal {
  for (NSString *name in [testDicts keyEnumerator]) {
    NSDictionary  *filterTestDict = testDicts[name];
    FileItemTest  *fileItemTest = [FileItemTest fileItemTestFromDictionary: filterTestDict];
    
    testsByNameVal[name] = fileItemTest;
  }
}


- (void) addStoredTestsFromArray:(NSArray *)testDicts
                     toLiveTests:(NSMutableDictionary *)testsByNameVal {
  for (NSDictionary *fileItemTestDict in [testDicts objectEnumerator]) {
    FileItemTest  *fileItemTest = [FileItemTest fileItemTestFromDictionary: fileItemTestDict];
    NSString  *name = fileItemTestDict[@"name"];

    testsByNameVal[name] = fileItemTest;
  }
}

@end // @implementation FilterTestRepository (PrivateMethods) 
