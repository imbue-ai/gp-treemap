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

#import "FilterEditor.h"

#import "NameValidator.h"
#import "ModalityTerminator.h"
#import "NotifyingDictionary.h"

#import "Filter.h"
#import "NamedFilter.h"
#import "FilterRepository.h"

#import "FilterWindowControl.h"


@interface FilterNameValidator : NSObject <NameValidator> {
  NSDictionary  *allFilters;
  NSString  *allowedName;
}

// Overrides designated initialiser.
- (instancetype) init NS_UNAVAILABLE;

- (instancetype) initWithExistingFilters:(NSDictionary *)allFilters;
- (instancetype) initWithExistingFilters:(NSDictionary *)allFilters
                             allowedName:(NSString *)name NS_DESIGNATED_INITIALIZER;

@end // @interface FilterNameValidator


@interface FilterEditor (PrivateMethods)

- (NSWindow *)loadEditFilterWindow;

@end // @interface FilterEditor (PrivateMethods)


@implementation FilterEditor

- (instancetype) init {
  return [self initWithFilterRepository: FilterRepository.defaultFilterRepository];
}

- (instancetype) initWithFilterRepository:(FilterRepository *)filterRepositoryVal {
  if (self = [super init]) {
    filterWindowControl = nil; // Load it lazily
  
    filterRepository = [filterRepositoryVal retain];
  }
  return self;
}

- (void) dealloc {
  [filterWindowControl release];
  [filterRepository release];
  
  [super dealloc];
}


- (NamedFilter *)createNamedFilter {
  NSWindow  *editFilterWindow = [self loadEditFilterWindow];
  
  FilterNameValidator  *nameValidator = 
    [[[FilterNameValidator alloc] initWithExistingFilters: filterRepository.filtersByName]
     autorelease];
  
  [filterWindowControl setNameValidator: nameValidator];
  [filterWindowControl representEmptyFilter];

  [ModalityTerminator modalityTerminatorForEventSource: filterWindowControl];
  NSInteger  status = [NSApp runModalForWindow: editFilterWindow];
  [editFilterWindow close];

  if (status == NSModalResponseStop) {
    NamedFilter  *namedFilter = [filterWindowControl createNamedFilter];
    
    if (namedFilter != nil) {
      // The nameValidator should have ensured that this check succeeds.
      NSAssert( filterRepository.filtersByName[namedFilter.name] == nil,
                @"Duplicate name check failed.");
      [filterRepository.filtersByNameAsNotifyingDictionary addObject: namedFilter.filter
                                                              forKey: namedFilter.name];
        
      // Rest of addition handled in response to notification event.
    }
    
    return namedFilter;
  }
  else {
    NSAssert(status == NSModalResponseAbort, @"Unexpected status.");
    
    return nil;
  }    
}


- (NamedFilter *)editFilterNamed:(NSString *)oldName {
  NSWindow  *editFilterWindow = [self loadEditFilterWindow];

  Filter  *oldFilter = filterRepository.filtersByName[oldName];

  NamedFilter  *oldNamedFilter = [NamedFilter namedFilter: oldFilter name: oldName];
  [filterWindowControl representNamedFilter: oldNamedFilter];

  if ([filterRepository applicationProvidedFilterForName: oldName] != nil) {
    // The filter's name equals that of an application provided filter. Show 
    // the localized version of the name (which implicitly prevents the name
    // from being changed).  
    NSBundle  *mainBundle = NSBundle.mainBundle;
    NSString  *localizedName =
      [mainBundle localizedStringForKey: oldName value: nil table: @"Names"];

    [filterWindowControl setVisibleName: localizedName];
  }
  
  FilterNameValidator  *testNameValidator = 
    [[[FilterNameValidator alloc]
        initWithExistingFilters: filterRepository.filtersByName
          allowedName: oldName] autorelease];
  [filterWindowControl setNameValidator: testNameValidator];
  
  [ModalityTerminator modalityTerminatorForEventSource: filterWindowControl];
  NSInteger  status = [NSApp runModalForWindow: editFilterWindow];
  [editFilterWindow close];
    
  if (status == NSModalResponseStop) {
    NamedFilter  *newNamedFilter = [filterWindowControl createNamedFilter];
    
    if (newNamedFilter != nil) {
      NSString  *newName = newNamedFilter.name;
      NotifyingDictionary  *repositoryFiltersByName =
        filterRepository.filtersByNameAsNotifyingDictionary;

      // The testNameValidator should have ensured that this check succeeds.
      NSAssert( 
        [newName isEqualToString: oldName] ||
        filterRepository.filtersByName[newName] == nil,
        @"Duplicate name check failed.");

      if (! [newName isEqualToString: oldName]) {
        // Handle name change.
        [repositoryFiltersByName moveObjectFromKey: oldName toKey: newName];
          
        // Rest of rename handled in response to update notification event.
      }
        
      // Filter itself has changed as well.
      [repositoryFiltersByName updateObject: newNamedFilter.filter forKey: newName];
    }
    
    return newNamedFilter;
  }
  else {
    NSAssert(status == NSModalResponseAbort, @"Unexpected status.");
    
    return nil;
  }
}

@end // @implementation FilterEditor


@implementation FilterEditor (PrivateMethods)

- (NSWindow *)loadEditFilterWindow {
  if (filterWindowControl == nil) {
    filterWindowControl = [[FilterWindowControl alloc] init];
  }
  // Return its window. This also ensure that it is loaded before its control is used.
  return filterWindowControl.window;
}

@end // @implementation FilterEditor (PrivateMethods)


@implementation FilterNameValidator

- (instancetype) initWithExistingFilters:(NSDictionary *)allFiltersVal {
  return [self initWithExistingFilters: allFiltersVal allowedName: nil];
}

- (instancetype) initWithExistingFilters:(NSDictionary *)allFiltersVal
                             allowedName:(NSString *)name {
  if (self = [super init]) {
    allFilters = [allFiltersVal retain];
    allowedName = [name retain];    
  }
  
  return self;
}

- (void) dealloc {
  [allFilters release];
  [allowedName release];

  [super dealloc];
}


- (NSString *)checkNameIsValid:(NSString *)name {
  if ([name isEqualToString:@""]) {
    return NSLocalizedString(@"The filter must have a name", @"Alert message");
  }
  else if ( ![allowedName isEqualToString: name] &&
            allFilters[name] != nil) {
    NSString  *fmt = NSLocalizedString(@"A filter named \"%@\" already exists",
                                       @"Alert message");
    return [NSString stringWithFormat: fmt, name];
  }
  
  // All OK
  return nil;
}

@end // @implementation FilterNameValidator
