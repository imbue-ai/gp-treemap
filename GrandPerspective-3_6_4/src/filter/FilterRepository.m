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

#import "FilterRepository.h"

#import "Filter.h"

#import "NotifyingDictionary.h"


// The key for storing user filters
NSString  *UserFiltersKey = @"filters";

// The key for storing application-provided tests
NSString  *AppFiltersKey = @"GPDefaultFilters";

// The name used for "no filter" option
NSString  *NoneFilter = @"None";


@interface FilterRepository (PrivateMethods)

/* Add filters as extracted from a property or user preferences file to the given dictionary.
 */
- (void) addStoredFilters:(NSDictionary *)storedFilters
            toLiveFilters:(NSMutableDictionary *)liveFilters;

@end // @interface FilterRepository (PrivateMethods)


@implementation FilterRepository

+ (FilterRepository *)defaultFilterRepository {
  static FilterRepository  *defaultInstance = nil;
  static dispatch_once_t  onceToken;

  dispatch_once(&onceToken, ^{
    defaultInstance = [[FilterRepository alloc] init];
  });
  
  return defaultInstance;
}


- (instancetype) init {
  if (self = [super init]) {
    NSMutableDictionary  *initialFilterDictionary =
      [NSMutableDictionary dictionaryWithCapacity: 16];
    
    // Load application-provided filters from the information properties file.
    [self addStoredFilters: [NSBundle.mainBundle objectForInfoDictionaryKey: AppFiltersKey]
             toLiveFilters: initialFilterDictionary];
    applicationProvidedFilters = [[NSDictionary alloc] initWithDictionary: initialFilterDictionary];

    // Load additional user-created tests from preferences.
    [self addStoredFilters: [NSUserDefaults.standardUserDefaults dictionaryForKey: UserFiltersKey]
             toLiveFilters: initialFilterDictionary];

    // Store filters in a NotifyingDictionary
    _filtersByName =
      (NSDictionary *)[[NotifyingDictionary alloc] initWithCapacity: 16
                                                    initialContents: initialFilterDictionary];
  }
  
  return self;
}

- (void) dealloc {
  [_filtersByName release];
  [applicationProvidedFilters release];

  [super dealloc];
}


- (NotifyingDictionary *)filtersByNameAsNotifyingDictionary {
  return (NotifyingDictionary *)self.filtersByName;
}


- (Filter *)filterForName:(NSString *)name {
  return self.filtersByName[name];
}

- (Filter *)applicationProvidedFilterForName:(NSString *)name {
  return applicationProvidedFilters[name];
}


- (void) storeUserCreatedFilters {
  NSUserDefaults  *userDefaults = NSUserDefaults.standardUserDefaults;
  
  NSMutableDictionary  *filtersDict = 
    [NSMutableDictionary dictionaryWithCapacity: self.filtersByName.count];


  for (NSString *name in [self.filtersByName keyEnumerator]) {
    Filter  *filter = self.filtersByName[name];

    if (filter != applicationProvidedFilters[name]) {
      filtersDict[name] = [filter dictionaryForObject];
    }
  }

  [userDefaults setObject: filtersDict forKey: UserFiltersKey];
  
  [userDefaults synchronize];
}

@end // @implementation FilterTestRepository


@implementation FilterRepository (PrivateMethods) 

- (void) addStoredFilters:(NSDictionary *)storedFilters
            toLiveFilters:(NSMutableDictionary *)liveFilters {
  for (NSString *name in [storedFilters keyEnumerator]) {
    NSDictionary  *storedFilter = storedFilters[name];
    Filter  *filter = [Filter filterFromDictionary: storedFilter];
    
    liveFilters[name] = filter;
  }
}

@end // @implementation FilterRepository (PrivateMethods) 
