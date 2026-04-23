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

#import "FilterSet.h"

#import "Filter.h"
#import "NamedFilter.h"
#import "CompoundAndItemTest.h"

#import "FilterRepository.h"
#import "FilterTestRepository.h"

@interface FilterSet (PrivateMethods)

- (instancetype) initWithNamedFilters:(NSArray *)filters
                      packagesAsFiles:(BOOL)packagesAsFiles
                     filterRepository:(FilterRepository *)filterRepository
                       testRepository:(FilterTestRepository *)testRepository
                       unboundFilters:(NSMutableArray *)unboundFilters
                         unboundTests:(NSMutableArray *)unboundTests;

@end // @interface FilterSet (PrivateMethods)


@implementation FilterSet

+ (instancetype) filterSet {
  return [[[FilterSet alloc] init] autorelease];
}

+ (instancetype) filterSetWithNamedFilter:(NamedFilter *)namedFilter
                          packagesAsFiles:(BOOL)packagesAsFiles
                           unboundFilters:(NSMutableArray *)unboundFilters
                             unboundTests:(NSMutableArray *)unboundTests {
  NSArray  *namedFilters = @[namedFilter];
  return [FilterSet filterSetWithNamedFilters: namedFilters
                              packagesAsFiles: packagesAsFiles
                               unboundFilters: unboundFilters
                                 unboundTests: unboundTests];
}

+ (instancetype) filterSetWithNamedFilters:(NSArray *)namedFilters
                           packagesAsFiles:(BOOL)packagesAsFiles
                            unboundFilters:(NSMutableArray *)unboundFilters
                              unboundTests:(NSMutableArray *)unboundTests {
  FilterRepository  *filterRepo = FilterRepository.defaultFilterRepository;
  FilterTestRepository  *testRepo = FilterTestRepository.defaultFilterTestRepository;
  return [FilterSet filterSetWithNamedFilters: namedFilters
                              packagesAsFiles: packagesAsFiles
                             filterRepository: filterRepo
                               testRepository: testRepo
                               unboundFilters: unboundFilters
                                 unboundTests: unboundTests];
}

+ (instancetype) filterSetWithNamedFilters:(NSArray *)namedFilters
                           packagesAsFiles:(BOOL)packagesAsFiles
                          filterRepository:(FilterRepository *)filterRepository
                            testRepository:(FilterTestRepository *)testRepository
                            unboundFilters:(NSMutableArray *)unboundFilters
                              unboundTests:(NSMutableArray *)unboundTests {
  return [[[FilterSet alloc] initWithNamedFilters: namedFilters
                                  packagesAsFiles: packagesAsFiles
                                 filterRepository: filterRepository
                                   testRepository: testRepository
                                   unboundFilters: unboundFilters
                                     unboundTests: unboundTests]
          autorelease];
}


// Overrides parent's designated initialiser.
- (instancetype) init {
  return [self initWithNamedFilters: @[] packagesAsFiles: NO fileItemTest: nil];
}

/* Designated initialiser.
 */
- (instancetype) initWithNamedFilters:(NSArray *)filters
                      packagesAsFiles:(BOOL)packagesAsFiles
                         fileItemTest:(FileItemTest *)fileItemTest {
  if (self = [super init]) {
    // Copy to ensure immutability
    _filters = [[filters copy] retain];
    _fileItemTest = [fileItemTest retain];
    _packagesAsFiles = packagesAsFiles;
  }
  return self;
}

- (void) dealloc {
  [_filters release];
  [_fileItemTest release];
  
  [super dealloc];
}


- (FilterSet *)updatedFilterSetUnboundFilters:(NSMutableArray *)unboundFilters
                                 unboundTests:(NSMutableArray *)unboundTests {
  return [self updatedFilterSetUsingFilterRepository: FilterRepository.defaultFilterRepository
                                      testRepository: FilterTestRepository.defaultFilterTestRepository
                                      unboundFilters: unboundFilters
                                        unboundTests: unboundTests];
}

- (FilterSet *)updatedFilterSetUsingFilterRepository:(FilterRepository *)filterRepository
                                      testRepository:(FilterTestRepository *)testRepository
                                      unboundFilters:(NSMutableArray *)unboundFilters
                                        unboundTests:(NSMutableArray *)unboundTests {
  return [[[FilterSet alloc] initWithNamedFilters: self.filters
                                  packagesAsFiles: self.packagesAsFiles
                                 filterRepository: filterRepository
                                   testRepository: testRepository
                                   unboundFilters: unboundFilters
                                     unboundTests: unboundTests] autorelease];
}

- (FilterSet *)filterSetWithAddedNamedFilter:(NamedFilter *)filter
                             packagesAsFiles:(BOOL)packagesAsFiles
                                unboundTests:(NSMutableArray *)unboundTests {
  NSMutableArray  *newFilters = [NSMutableArray arrayWithCapacity: self.numFilters + 1];
    
  [newFilters addObjectsFromArray: self.filters];
  [newFilters addObject: filter];

  FileItemTest  *testForNewFilter = [filter.filter createFileItemTestUnboundTests: unboundTests];

  // Construct new file item test by combining test for new filter with existing file item test.
  FileItemTest  *newFileItemTest;
  if (self.fileItemTest == nil) {
    newFileItemTest = testForNewFilter;
  } else if (testForNewFilter == nil) {
    newFileItemTest = self.fileItemTest;
  } else {
    newFileItemTest =
      [[CompoundAndItemTest alloc] initWithSubItemTests: @[self.fileItemTest, testForNewFilter]];
  }

  return [[[FilterSet alloc] initWithNamedFilters: newFilters
                                  packagesAsFiles: packagesAsFiles
                                     fileItemTest: newFileItemTest] autorelease];
}


- (NSUInteger) numFilters {
  return self.filters.count;
}

- (NSString *)description {
  NSMutableString  *descr = [NSMutableString stringWithCapacity: 32];
  
  for (NamedFilter *namedFilter in [self.filters objectEnumerator]) {
    if (descr.length > 0) {
      [descr appendString: @", "];
    }
    [descr appendString: namedFilter.localizedName];
  }
  
  return descr;
}

@end // @implementation FilterSet


@implementation FilterSet (PrivateMethods)

- (instancetype) initWithNamedFilters:(NSArray *)namedFilters
                      packagesAsFiles:(BOOL)packagesAsFiles
                     filterRepository:(FilterRepository *)filterRepository
                       testRepository:(FilterTestRepository *)testRepository
                       unboundFilters:(NSMutableArray *)unboundFilters
                         unboundTests:(NSMutableArray *)unboundTests {
  // Create the file item test for the set of filters.
  NSMutableArray  *filterTests = [NSMutableArray arrayWithCapacity: namedFilters.count];

  for (NamedFilter *namedFilter in [namedFilters objectEnumerator]) {
    Filter  *filter;

    if (filterRepository == nil) {
      // Preserve old filter
      filter = namedFilter.filter;
    } else {
      // Look-up current filter definition
      filter = filterRepository.filtersByName[namedFilter.name];
      if (filter == nil) {
        // The filter with this name does not exist anymore in the repository
        [unboundFilters addObject: namedFilter.name];

        // So resort to the original filter
        filter = namedFilter.filter;
      }
    }

    FileItemTest  *filterTest = [filter createFileItemTestFromRepository: testRepository
                                                            unboundTests: unboundTests];
    if (filterTest != nil) {
      [filterTests addObject: filterTest];
    } else {
      // Apparently the filter or its item test(s) do not exist anymore.
      NSLog(@"Could not instantiate test for filter %@", namedFilter.name);
    }
  }

  FileItemTest  *testForFilterSet;
  if (filterTests.count == 0) {
    testForFilterSet = nil;
  }
  else if (filterTests.count == 1) {
    testForFilterSet = filterTests[0];
  }
  else {
    testForFilterSet = [[[CompoundAndItemTest alloc] initWithSubItemTests: filterTests]
                        autorelease];
  }

  return [self initWithNamedFilters: namedFilters
                    packagesAsFiles: packagesAsFiles
                       fileItemTest: testForFilterSet];
}

@end // @implementation FilterSet (PrivateMethods)
